"""
Purpose: FastAPI app orchestrating Overmind execution runs.
High-level behavior: Exposes /runs, /health, and /initialize_codebase endpoints.
  Workers run in-process via asyncio.create_task; for production, hook in
  ECS Fargate task dispatch or Lambda invocation in create_run().
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

from openai import AsyncOpenAI

from agent_tools import (
    AGENT_SYSTEM_PROMPT,
    TOOL_SCHEMAS,
    build_agent_user_message,
    execute_tool,
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
from run_store import (
    AgentResult,
    FileChange,
    RunStatusRecord,
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


APP_NAME = "overmind-orchestrator"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_URL = os.environ.get("OVERMIND_LLM_URL", "").rstrip("/")
LLM_TIMEOUT_S = int(os.environ.get("OVERMIND_LLM_TIMEOUT_S", "3600"))
OVERMIND_DATABASE_URL = os.environ.get("OVERMIND_DATABASE_URL", "")
MAX_AGENT_ROUNDS = 10

PLANNING_SYSTEM_PROMPT = """You are an expert Planner Agent.
Your sole responsibility is to analyze the user's overarching query and decompose it into a series of clear, isolated, and actionable tasks.
These tasks will be executed by specialized downstream agents.

Constraints and Rules:
1. Each task must be independent and clearly defined.
2. Provide specific success criteria or context for each task.
3. Do not attempt to write code or execute the tasks yourself.
4. Output your plan as a structured JSON array of task objects, where each object has a 'description' and 'context' field.
"""
# populated by the FastAPI lifespan handler; None when DATABASE_URL is unset
db_pool: Any = None

# Lazily-cached embedding model (fastembed TextEmbedding is expensive to construct)
_embedding_model: Any = None

# Strong references to background tasks to prevent GC before completion
_active_tasks: set[asyncio.Task] = set()


def _get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        model_name = os.environ.get("OVERMIND_EMBEDDING_MODEL", "BAAI/bge-large-en-v1.5")
        _embedding_model = TextEmbedding(model_name)
    return _embedding_model

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

class RunCreateRequest(BaseModel):
    runId: str
    promptId: str
    prompt: str
    story: str
    scope: Optional[list[str]] = None
    files: dict[str, str]


class RunCreateResponse(BaseModel):
    runId: str


async def generate_embedding(text: str) -> list[float]:
    """
    Generate a text embedding via fastembed (ONNX, CPU/GPU).
    Default model: BAAI/bge-large-en-v1.5 (1024-dim).
    Edge cases: Raises on model/network errors; callers must wrap in try/except.
    Invariants: Returns a list of floats with fixed dimensionality.
    """
    model = _get_embedding_model()
    return next(iter(model.embed([text]))).tolist()


async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """
    Batch-embed texts using fastembed in a thread pool to avoid blocking the event loop.
    Invariants: Returns one vector per input text, same order.
    """
    loop = asyncio.get_running_loop()
    model = _get_embedding_model()

    def _run() -> list[list[float]]:
        return [v.tolist() for v in model.embed(texts)]

    return await loop.run_in_executor(None, _run)

async def agent_loop(req: RunCreateRequest, run_id: str) -> AgentResult:
    """
    Run the agentic tool-calling loop against the configured LLM.
    Uses the OpenAI SDK with native tool calling — the model receives typed
    tool schemas and returns structured tool_calls instead of free-form JSON.
    Does not write to disk; all mutations go into the workspace dict.
    Edge cases: Returns partial workspace on round exhaustion.
    Invariants: Always returns AgentResult; never raises.
    """
    if not LLM_URL:
        raise RuntimeError("OVERMIND_LLM_URL is not set")

    client = AsyncOpenAI(
        base_url=f"{LLM_URL}/v1",
        api_key=os.environ.get("OVERMIND_LLM_API_KEY", "sk-not-needed"),
        timeout=float(LLM_TIMEOUT_S),
    )

    ctx: dict[str, Any] = {
        "db_pool": db_pool,
        "generate_embedding": generate_embedding,
    }

    messages: list[dict] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": build_agent_user_message(req)},
    ]
    workspace: dict[str, str] = {}

    for round_num in range(1, MAX_AGENT_ROUNDS + 1):
        if await should_cancel(run_id):
            break

        log(f"agent_loop: run_id={run_id} round={round_num}/{MAX_AGENT_ROUNDS}")

        response = await client.chat.completions.create(
            model=MODEL_ID,
            messages=messages,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
            temperature=0,
        )

        msg = response.choices[0].message
        # Preserve the assistant message (including tool_calls metadata).
        messages.append(msg.model_dump(exclude_none=True))

        # No tool calls → model decided it is done.
        if not msg.tool_calls:
            log(f"agent_loop: no tool calls round={round_num}, finishing")
            break

        tool_name = ""
        for tc in msg.tool_calls:
            tool_name = tc.function.name

            try:
                args = json.loads(tc.function.arguments)
            except (json.JSONDecodeError, TypeError):
                log(f"agent_loop: bad tool args round={round_num}")
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": "Error: malformed tool arguments",
                })
                continue

            if tool_name == "finish":
                summary = args.get("summary", "Changes applied")
                log(f"agent_loop: finished round={round_num}")
                return AgentResult(
                    summary=summary,
                    files=[
                        FileChange(path=p, content=c)
                        for p, c in sorted(workspace.items())
                    ],
                )

            result = await execute_tool(tool_name, args, req.files, workspace, ctx)
            log(f"agent_loop: tool={tool_name} result_len={len(result)}")

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

        await update_run_record(run_id, {
            "stage": STAGE_WORKING,
            "detail": f"Round {round_num}: {tool_name}",
        })

    log(f"agent_loop: run_id={run_id} exhausted {MAX_AGENT_ROUNDS} rounds")
    return AgentResult(
        summary="Agent completed (max rounds reached)",
        files=[
            FileChange(path=p, content=c)
            for p, c in sorted(workspace.items())
        ],
    )


async def run_worker(run_id: str, req: RunCreateRequest) -> None:
    """
    Execute a run: run the agent loop and persist the result.
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


@web_app.get("/health")
async def health() -> dict[str, object]:
    """
    Check LLM reachability.
    Does not raise on failure.
    Invariants: Always returns a status dict.
    """
    if not LLM_URL:
        return {"status": "ok", "llm_connected": False, "error": "OVERMIND_LLM_URL not set"}
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
    Enqueue a run and spawn a worker.
    Currently spawns in-process via asyncio.create_task.
    For production, replace the spawn line with ECS Fargate task dispatch
    or Lambda invocation.
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

    task = asyncio.create_task(run_worker(req.runId, req))
    _active_tasks.add(task)
    task.add_done_callback(_active_tasks.discard)

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
    Does not delete existing chunks; re-runs only add new ones.
    Edge cases: Returns 503 if DB or embedding service is unavailable.
    Invariants: resolvedProjectId may differ from req.projectId when a very
      similar project already exists (cosine similarity > SIMILARITY_THRESHOLD).
    """
    if db_pool is None:
        raise HTTPException(status_code=503, detail="database not connected")

    log(f"initialize_codebase: projectId={req.projectId} branch={req.branchName} files={len(req.files)}")

    # Chunk all files
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

    # Generate all embeddings in a single batch (thread pool, non-blocking)
    try:
        embeddings: list[list[float]] = await generate_embeddings_batch(
            [c["chunk_text"] for c in all_chunks]
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
