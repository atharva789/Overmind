"""
Purpose: Orchestrate Overmind execution runs via Modal workers.
High-level behavior: Creates runs, spawns workers, and serves run status.
Assumptions: OVERMIND_LLM_URL points to a vLLM OpenAI-compatible API.
Invariants: Handlers never generate edits; workers produce all file updates.
"""

from __future__ import annotations

import hashlib
import json
import os
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import modal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from agent_tools import (
    AGENT_SYSTEM_PROMPT,
    build_agent_user_message,
    execute_tool,
    parse_tool_call_json,
)
from codebase_indexer import (
    chunk_file, average_vectors, InitializeCodebaseRequest, InitializeCodebaseResponse,
)
from codebase_store import (
    upsert_branch_only,
    resolve_similar_project,
    upsert_branch_and_chunks,
)
from run_store import (
    FileChange, ToolCall, AgentResult, RunStatusRecord,
    run_store, run_record_to_dict,
    read_run_record, write_run_record, update_run_record,
    should_cancel, mark_run_running, mark_run_canceled,
    mark_run_failed, mark_run_completed,
    STATUS_QUEUED, STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELED,
    STAGE_SPAWNING, STAGE_WORKING,
)

APP_NAME = "overmind-orchestrator"
DEFAULT_LLM_URL = "https://atharva789--overmind-llm-llmserver-serve.modal.run"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_URL = os.environ.get("OVERMIND_LLM_URL", DEFAULT_LLM_URL).rstrip("/")
LLM_TIMEOUT_S = int(os.environ.get("OVERMIND_LLM_TIMEOUT_S", "3600"))
LOG_TRUNCATE_CHARS = 1000
MAX_AGENT_ROUNDS = 10
MAX_PARSE_RETRIES = 2
LLM_SECRET_NAME = "overmind-llm-auth"

image = modal.Image.debian_slim().pip_install(
    "fastapi",
    "httpx",
)

app = modal.App(APP_NAME)
web_app = FastAPI()

# asyncpg connection pool; populated lazily on first DB-touching request.
db_pool: Any = None


class RunCreateRequest(BaseModel):
    runId: str
    promptId: str
    prompt: str
    story: str
    scope: Optional[list[str]] = None
    files: dict[str, str]


class RunCreateResponse(BaseModel):
    runId: str


def now_iso() -> str:
    """
    Build a UTC ISO timestamp string.
    Does not read external time sources beyond system clock.
    Edge cases: None.
    Invariants: Always returns timezone-aware ISO strings.
    """
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    """
    Write a timestamped log message.
    Does not include prompt content.
    Edge cases: Long messages are truncated.
    Invariants: Log entries always include UTC timestamps.
    """
    ts = now_iso()
    truncated = message[:LOG_TRUNCATE_CHARS]
    print(f"[{ts}] {truncated}")


async def agent_loop(req: RunCreateRequest, run_id: str) -> AgentResult:
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{LLM_URL}/v1/chat/completions"
    timeout = httpx.Timeout(timeout=LLM_TIMEOUT_S, connect=30.0)

    messages: list[dict[str, str]] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": build_agent_user_message(req)},
    ]

    workspace: dict[str, str] = {}

    for round_num in range(1, MAX_AGENT_ROUNDS + 1):
        if await should_cancel(run_id):
            break

        log(f"agent_loop: run_id={run_id} round={round_num}/{MAX_AGENT_ROUNDS} messages={len(messages)}")

        payload = {
            "model": MODEL_ID,
            "messages": messages,
            "temperature": 0,
            "top_p": 1,
            "seed": 0,
            "response_format": {"type": "json_object"},
        }

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            log(f"agent_loop: response status={response.status_code}")
            response.raise_for_status()
            data = response.json()

        choices = data.get("choices")
        if not choices:
            raise ValueError("LLM response missing choices")
        message = choices[0].get("message") or {}
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("LLM response missing content")

        log(f"agent_loop: round={round_num} content ({len(content)} chars): {content[:300]}")

        try:
            parsed = parse_tool_call_json(content)
            tool_call = ToolCall(tool=parsed["tool"], args=parsed.get("args", {}))
        except (json.JSONDecodeError, ValueError, KeyError) as exc:
            log(f"agent_loop: parse failed round={round_num}: {exc}")
            messages.append({"role": "assistant", "content": content})
            messages.append({
                "role": "user",
                "content": (
                    "Your previous response was not valid JSON. "
                    "Respond with ONLY a JSON object like: "
                    '{"tool": "read_file", "args": {"path": "file.ts"}}'
                ),
            })
            continue

        messages.append({"role": "assistant", "content": content})

        if tool_call.tool == "finish":
            summary = tool_call.args.get("summary", "Changes applied")
            log(f"agent_loop: finished at round {round_num}: {summary}")
            files = [FileChange(path=p, content=c) for p, c in sorted(workspace.items())]
            return AgentResult(summary=summary, files=files)

        await update_run_record(run_id, {
            "stage": STAGE_WORKING,
            "detail": f"Round {round_num}: {tool_call.tool}({', '.join(f'{k}={v[:50]}' for k, v in tool_call.args.items() if k != 'content')})",
        })

        result = execute_tool(tool_call.tool, tool_call.args, req.files, workspace)
        log(f"agent_loop: tool={tool_call.tool} result_len={len(result)}")
        messages.append({"role": "user", "content": f"Tool result:\n{result}"})

    log(f"agent_loop: run_id={run_id} exhausted {MAX_AGENT_ROUNDS} rounds, returning workspace")
    files = [FileChange(path=p, content=c) for p, c in sorted(workspace.items())]
    return AgentResult(summary="Agent completed (max rounds reached)", files=files)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name(LLM_SECRET_NAME)],
    timeout=3600,
)
async def run_worker(run_id: str, req: RunCreateRequest) -> None:
    """
    Execute a run inside a Modal worker function.
    Does not write to the host filesystem.
    Edge cases: Cancels early if run is marked canceled.
    Invariants: Updates run status on all exit paths.
    """
    log(f"run_worker: start run_id={run_id} prompt_len={len(req.prompt)} files={len(req.files)}")
    await mark_run_running(run_id)

    if await should_cancel(run_id):
        log(f"run_worker: run_id={run_id} canceled before execution")
        await mark_run_canceled(run_id, "Run canceled before execution.")
        return

    try:
        result = await agent_loop(req, run_id)
    except Exception as exc:
        log(f"run_worker: run_id={run_id} agent error:\n{traceback.format_exc()}")
        await mark_run_failed(
            run_id,
            STAGE_WORKING,
            "Agent execution failed.",
            str(exc),
        )
        return

    log(f"run_worker: run_id={run_id} completed summary_len={len(result.summary)} files={len(result.files)}")
    await mark_run_completed(run_id, result)


@web_app.get("/health")
async def health() -> dict[str, object]:
    """
    Check LLM connectivity by requesting the model list.
    Does not raise on failure.
    Edge cases: Returns llm_connected=false on errors.
    Invariants: Always returns a status payload.
    """
    url = f"{LLM_URL}/v1/models"
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
        return {"status": "ok", "llm_connected": True}
    except Exception as exc:
        log(f"health check failed: {exc}")
        return {"status": "ok", "llm_connected": False}


@web_app.post("/runs")
async def create_run(req: RunCreateRequest) -> RunCreateResponse:
    """
    Create a run record and spawn a worker.
    Does not call the LLM in-process.
    Edge cases: Rejects duplicate run IDs.
    Invariants: Newly created runs start in queued state.
    """
    if await run_store.get.aio(req.runId) is not None:
        raise HTTPException(status_code=409, detail="run already exists")

    log(
        "create runId="
        f"{req.runId} prompt_len={len(req.prompt)} "
        f"files={len(req.files)}"
    )

    record = RunStatusRecord(
        status=STATUS_QUEUED,
        stage=STAGE_SPAWNING,
        detail=None,
        files=None,
        summary=None,
        error=None,
        updatedAt=now_iso(),
    )
    await write_run_record(req.runId, record)

    await run_worker.spawn.aio(req.runId, req)
    return RunCreateResponse(runId=req.runId)


@web_app.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, object]:
    """
    Return the current status of a run.
    Does not mutate run state.
    Edge cases: Raises 404 for missing runs.
    Invariants: Responses are schema-validated.
    """
    try:
        record = await read_run_record(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="run not found")
    return run_record_to_dict(record)


@web_app.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str) -> dict[str, object]:
    """
    Cancel a run by updating its status.
    Does not terminate running workers.
    Edge cases: Raises 404 for missing runs.
    Invariants: Canceled runs remain terminal.
    """
    try:
        record = await read_run_record(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="run not found")

    if record.status in {STATUS_COMPLETED, STATUS_FAILED}:
        return {"ok": True}

    await update_run_record(
        run_id,
        {
            "status": STATUS_CANCELED,
            "stage": None,
            "detail": "Run canceled by client.",
        },
    )
    return {"ok": True}


async def _generate_embedding(text: str) -> list[float]:
    """
    Generate a text embedding via the LocalEmbedder Modal class.
    Does not cache results.
    Edge cases: raises on Modal/GPU errors; callers should wrap in try/except.
    """
    from modal import Cls
    LocalEmbedder = Cls.from_name(APP_NAME, "LocalEmbedder")
    embedder = LocalEmbedder()
    result = await embedder.embed.aio(text)
    return result


@web_app.post("/initialize_codebase")
async def initialize_codebase(req: InitializeCodebaseRequest) -> InitializeCodebaseResponse:
    """
    Chunk and embed all files for a project, then store them in the DB.
    Delegates DB writes to codebase_store helpers and embedding to LocalEmbedder.
    Does not delete existing chunks; re-runs only add new ones.
    Edge cases: Returns 503 if DB or embedding service is unavailable.
    Invariants: resolvedProjectId may differ from req.projectId when a similar
      project already exists (cosine similarity > SIMILARITY_THRESHOLD).
    """
    global db_pool

    log(
        f"initialize_codebase: projectId={req.projectId} "
        f"branch={req.branchName} files={len(req.files)}"
    )

    if db_pool is None:
        raise HTTPException(status_code=503, detail="database not connected")

    all_chunks: list[dict] = []
    file_hashes: dict[str, str] = {}
    for path, content in req.files.items():
        file_hashes[path] = hashlib.md5(content.encode()).hexdigest()
        all_chunks.extend(chunk_file(path, content))

    if not all_chunks:
        branch_id = await upsert_branch_only(db_pool, req.projectId, req.branchName)
        return InitializeCodebaseResponse(
            resolvedProjectId=req.projectId,
            branchId=branch_id,
            chunksStored=0,
        )

    embeddings: list[list[float]] = []
    try:
        for chunk in all_chunks:
            emb = await _generate_embedding(chunk["chunk_text"])
            embeddings.append(emb)
    except Exception as exc:
        log(f"initialize_codebase: embedding error: {exc}")
        raise HTTPException(status_code=503, detail="embedding service unavailable")

    new_centroid = average_vectors(embeddings)
    resolved_project_id = await resolve_similar_project(
        db_pool, req.projectId, new_centroid
    )

    branch_id, chunks_stored = await upsert_branch_and_chunks(
        db_pool, resolved_project_id, req.branchName,
        all_chunks, embeddings, file_hashes,
    )

    return InitializeCodebaseResponse(
        resolvedProjectId=resolved_project_id,
        branchId=branch_id,
        chunksStored=chunks_stored,
    )


@app.function(
    image=image,
    secrets=[modal.Secret.from_name(LLM_SECRET_NAME)],
)
@modal.asgi_app()
def fastapi_app() -> FastAPI:
    """
    Expose the FastAPI application via Modal.
    Does not mutate application state.
    Edge cases: None.
    Invariants: Returns the shared web_app instance.
    """
    return web_app
