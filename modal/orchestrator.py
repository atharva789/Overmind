"""
Purpose: FastAPI app orchestrating Overmind execution runs.
High-level behavior: Exposes /runs, /health, and /initialize_codebase endpoints.
  Workers are spawned via run_worker (provider-agnostic dispatch in entry_modal.py).
Assumptions: OVERMIND_LLM_URL points to an OpenAI-compatible chat completions API.
Invariants: Handlers never generate file edits; workers produce all file updates.
  db_pool is None when OVERMIND_DATABASE_URL is unset; DB endpoints return 503.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import traceback
from contextlib import asynccontextmanager
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from agent_tools import (
    AGENT_SYSTEM_PROMPT,
    build_agent_user_message,
    execute_tool,
    parse_tool_call_json,
)
from codebase_indexer import (
    InitializeCodebaseRequest,
    InitializeCodebaseResponse,
    average_vectors,
    chunk_file,
)
from codebase_store import (
    resolve_similar_project,
    upsert_branch_and_chunks,
    upsert_branch_only,
)
from gpu_process import gpu_process
from run_store import (
    AgentResult,
    FileChange,
    RunStatusRecord,
    ToolCall,
    mark_run_canceled,
    mark_run_completed,
    mark_run_failed,
    mark_run_running,
    run_exists,
    run_record_to_dict,
    read_run_record,
    should_cancel,
    update_run_record,
    write_run_record,
    STATUS_CANCELED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_QUEUED,
    STAGE_SPAWNING,
    STAGE_WORKING,
)
from utils import log, now_iso

# ─── Configuration ────────────────────────────────────────────────────────────

APP_NAME = "overmind-orchestrator"
DEFAULT_LLM_URL = "https://atharva789--overmind-llm-llmserver-serve.modal.run"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_URL = os.environ.get("OVERMIND_LLM_URL", DEFAULT_LLM_URL).rstrip("/")
LLM_TIMEOUT_S = int(os.environ.get("OVERMIND_LLM_TIMEOUT_S", "3600"))
OVERMIND_DATABASE_URL = os.environ.get("OVERMIND_DATABASE_URL", "")
MAX_AGENT_ROUNDS = 10

# ─── DB pool ─────────────────────────────────────────────────────────────────

# Populated by the FastAPI lifespan handler; None when DATABASE_URL is unset.
db_pool: Any = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and tear down the asyncpg connection pool."""
    global db_pool
    if OVERMIND_DATABASE_URL:
        log("lifespan: connecting to database...")
        import asyncpg
        db_pool = await asyncpg.create_pool(
            dsn=OVERMIND_DATABASE_URL,
            min_size=2,
            max_size=10,
            ssl="require",
        )
        log("lifespan: database pool ready.")
    else:
        log("lifespan: OVERMIND_DATABASE_URL not set, skipping DB pool.")
    yield
    if db_pool:
        await db_pool.close()
        log("lifespan: database pool closed.")


web_app = FastAPI(lifespan=lifespan)

# ─── Request / response models ────────────────────────────────────────────────


class RunCreateRequest(BaseModel):
    runId: str
    promptId: str
    prompt: str
    story: str
    scope: Optional[list[str]] = None
    files: dict[str, str]


class RunCreateResponse(BaseModel):
    runId: str


# ─── Embedding (provider-agnostic via @gpu_process) ──────────────────────────


@gpu_process(gpu="T4", timeout=60)
async def generate_embedding(text: str) -> list[float]:
    """
    Generate a text embedding using the configured GPU backend.
    Route is determined by OVERMIND_GPU_BACKEND (modal | aws | local).
    Edge cases: Raises on GPU/network errors; callers must wrap in try/except.
    Invariants: Returns a list of floats with fixed dimensionality.
    """
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(
        os.environ.get("OVERMIND_EMBEDDING_MODEL", "nomic-ai/nomic-embed-text-v1.5"),
        trust_remote_code=True,
    )
    return model.encode([text])[0].tolist()


# ─── Agent loop ───────────────────────────────────────────────────────────────


async def agent_loop(req: RunCreateRequest, run_id: str) -> AgentResult:
    """
    Run the agentic tool-calling loop against the configured LLM.
    Does not write to disk; all mutations go into the workspace dict.
    Edge cases: Returns partial workspace on round exhaustion.
    Invariants: Always returns AgentResult; never raises.
    """
    headers: dict[str, str] = {"Content-Type": "application/json"}
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = f"{LLM_URL}/v1/chat/completions"
    timeout = httpx.Timeout(timeout=LLM_TIMEOUT_S, connect=30.0)

    messages: list[dict] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": build_agent_user_message(req)},
    ]
    workspace: dict[str, str] = {}

    # Single client reused across all rounds — avoids per-round TLS handshake.
    async with httpx.AsyncClient(timeout=timeout) as client:
        for round_num in range(1, MAX_AGENT_ROUNDS + 1):
            if await should_cancel(run_id):
                break

            log(f"agent_loop: run_id={run_id} round={round_num}/{MAX_AGENT_ROUNDS}")

            response = await client.post(
                url, headers=headers,
                json={
                    "model": MODEL_ID,
                    "messages": messages,
                    "temperature": 0,
                    "top_p": 1,
                    "seed": 0,
                    "response_format": {"type": "json_object"},
                },
            )
            log(f"agent_loop: status={response.status_code}")
            response.raise_for_status()

            data = response.json()
            choices = data.get("choices")
            if not choices:
                raise ValueError("LLM response missing choices")
            content = (choices[0].get("message") or {}).get("content", "")
            if not isinstance(content, str) or not content.strip():
                raise ValueError("LLM response missing content")

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
                        'Respond with ONLY: {"tool": "read_file", "args": {"path": "file.ts"}}'
                    ),
                })
                continue

            messages.append({"role": "assistant", "content": content})

            if tool_call.tool == "finish":
                summary = tool_call.args.get("summary", "Changes applied")
                log(f"agent_loop: finished round={round_num}")
                files = [FileChange(path=p, content=c) for p, c in sorted(workspace.items())]
                return AgentResult(summary=summary, files=files)

            await update_run_record(run_id, {
                "stage": STAGE_WORKING,
                "detail": f"Round {round_num}: {tool_call.tool}",
            })

            result = execute_tool(tool_call.tool, tool_call.args, req.files, workspace)
            log(f"agent_loop: tool={tool_call.tool} result_len={len(result)}")
            messages.append({"role": "user", "content": f"Tool result:\n{result}"})

    log(f"agent_loop: run_id={run_id} exhausted {MAX_AGENT_ROUNDS} rounds")
    files = [FileChange(path=p, content=c) for p, c in sorted(workspace.items())]
    return AgentResult(summary="Agent completed (max rounds reached)", files=files)


# ─── Worker entry point (called by provider entry points) ────────────────────


async def run_worker(run_id: str, req: RunCreateRequest) -> None:
    """
    Execute a run: run the agent loop and persist the result.
    Called by provider entry points (entry_modal.py, entry_aws.py, etc.).
    Does not write to the host filesystem.
    Edge cases: Cancels early if run is marked canceled before execution starts.
    Invariants: Updates run status on all exit paths.
    """
    log(f"run_worker: start run_id={run_id} files={len(req.files)}")
    await mark_run_running(run_id)

    if await should_cancel(run_id):
        log(f"run_worker: run_id={run_id} canceled before execution")
        await mark_run_canceled(run_id, "Run canceled before execution.")
        return

    try:
        result = await agent_loop(req, run_id)
    except Exception as exc:
        log(f"run_worker: run_id={run_id} error:\n{traceback.format_exc()}")
        await mark_run_failed(run_id, STAGE_WORKING, "Agent execution failed.", str(exc))
        return

    log(f"run_worker: run_id={run_id} completed files={len(result.files)}")
    await mark_run_completed(run_id, result)


# ─── HTTP endpoints ───────────────────────────────────────────────────────────


@web_app.get("/health")
async def health() -> dict[str, object]:
    """
    Check LLM reachability.
    Does not raise on failure.
    Invariants: Always returns a status dict.
    """
    url = f"{LLM_URL}/v1/models"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            (await client.get(url, headers=headers)).raise_for_status()
        return {"status": "ok", "llm_connected": True}
    except Exception as exc:
        log(f"health: {exc}")
        return {"status": "ok", "llm_connected": False}


@web_app.post("/runs")
async def create_run(req: RunCreateRequest) -> RunCreateResponse:
    """
    Enqueue a run. Spawning is delegated to the provider entry point via a
    RUN_STORE_BACKEND-agnostic store; the actual worker is started by the
    provider (Modal spawn, AWS Lambda invoke, asyncio.create_task).
    Does not call the LLM in-process.
    Edge cases: Rejects duplicate run IDs.
    Invariants: Newly created runs start in queued state.
    """
    if await run_exists(req.runId):
        raise HTTPException(status_code=409, detail="run already exists")

    log(f"create_run: runId={req.runId} files={len(req.files)}")

    await write_run_record(
        req.runId,
        RunStatusRecord(
            status=STATUS_QUEUED,
            stage=STAGE_SPAWNING,
            updatedAt=now_iso(),
        ),
    )

    # Provider-specific worker dispatch is in entry_modal.py / entry_aws.py.
    # For in-process use (memory backend), spawn directly.
    if os.environ.get("RUN_STORE_BACKEND", "modal") != "modal":
        asyncio.create_task(run_worker(req.runId, req))

    return RunCreateResponse(runId=req.runId)


@web_app.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, object]:
    """
    Return the current status of a run.
    Edge cases: Raises 404 for missing runs.
    Invariants: Response is schema-validated.
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
    Does not terminate already-running workers.
    Edge cases: Raises 404 for missing runs; no-ops on terminal states.
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
        {"status": STATUS_CANCELED, "stage": None, "detail": "Run canceled by client."},
    )
    return {"ok": True}


@web_app.post("/initialize_codebase")
async def initialize_codebase(req: InitializeCodebaseRequest) -> InitializeCodebaseResponse:
    """
    Chunk and embed all project files, then store them in the DB.
    Embedding is routed via @gpu_process (Modal, AWS, or local).
    Does not delete existing chunks; re-runs only add new ones.
    Edge cases: Returns 503 if DB or embedding service is unavailable.
    Invariants: resolvedProjectId may differ from req.projectId when a very
      similar project already exists (cosine similarity > SIMILARITY_THRESHOLD).
    """
    if db_pool is None:
        raise HTTPException(status_code=503, detail="database not connected")

    log(f"initialize_codebase: projectId={req.projectId} branch={req.branchName} files={len(req.files)}")

    # Chunk all files.
    all_chunks: list[dict] = []
    file_hashes: dict[str, str] = {}
    for path, content in req.files.items():
        file_hashes[path] = hashlib.md5(content.encode()).hexdigest()
        all_chunks.extend(chunk_file(path, content))

    if not all_chunks:
        branch_id = await upsert_branch_only(db_pool, req.projectId, req.branchName)
        return InitializeCodebaseResponse(
            resolvedProjectId=req.projectId, branchId=branch_id, chunksStored=0
        )

    # Generate all embeddings in parallel.
    try:
        embeddings: list[list[float]] = list(
            await asyncio.gather(*[generate_embedding(c["chunk_text"]) for c in all_chunks])
        )
    except Exception as exc:
        log(f"initialize_codebase: embedding error: {exc}")
        raise HTTPException(status_code=503, detail="embedding service unavailable")

    new_centroid = average_vectors(embeddings)
    resolved_project_id = await resolve_similar_project(db_pool, req.projectId, new_centroid)

    branch_id, chunks_stored = await upsert_branch_and_chunks(
        db_pool, resolved_project_id, req.branchName, all_chunks, embeddings, file_hashes,
    )

    return InitializeCodebaseResponse(
        resolvedProjectId=resolved_project_id,
        branchId=branch_id,
        chunksStored=chunks_stored,
    )
