"""
Purpose: Orchestrate Overmind execution runs via Modal workers.
High-level behavior: Creates runs, spawns workers, and serves run status.
Assumptions: OVERMIND_LLM_URL points to a vLLM OpenAI-compatible API.
Invariants: Handlers never generate edits; workers produce all file updates.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import modal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

APP_NAME = "overmind-orchestrator"
RUN_STORE_NAME = "overmind-orchestrator-runs"
DEFAULT_LLM_URL = "https://atharva789--overmind-llm-llmserver-serve.modal.run"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_URL = os.environ.get("OVERMIND_LLM_URL", DEFAULT_LLM_URL).rstrip("/")
LLM_TIMEOUT_S = int(os.environ.get("OVERMIND_LLM_TIMEOUT_S", "3600"))
LOG_TRUNCATE_CHARS = 1000
MAX_AGENT_ROUNDS = 10
MAX_PARSE_RETRIES = 2
LLM_SECRET_NAME = "overmind-llm-auth"

STAGE_SPAWNING = "Spawning sandbox..."
STAGE_WORKING = "Agent is working..."
STAGE_EXTRACTING = "Extracting changes..."

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELED = "canceled"

image = modal.Image.debian_slim().pip_install(
    "fastapi",
    "httpx",
)

app = modal.App(APP_NAME)
run_store = modal.Dict.from_name(RUN_STORE_NAME, create_if_missing=True)
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


class FileChange(BaseModel):
    path: str
    content: str


class ToolCall(BaseModel):
    tool: str
    args: dict[str, str]


class AgentResult(BaseModel):
    summary: str
    files: list[FileChange]


class RunStatusRecord(BaseModel):
    status: str
    stage: Optional[str] = None
    detail: Optional[str] = None
    files: Optional[list[FileChange]] = None
    summary: Optional[str] = None
    error: Optional[str] = None
    updatedAt: str


class InitializeCodebaseRequest(BaseModel):
    projectId: str
    branchName: str = "main"
    files: dict[str, str]  # path → content


class InitializeCodebaseResponse(BaseModel):
    resolvedProjectId: str
    branchId: str
    chunksStored: int


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


AGENT_SYSTEM_PROMPT = """\
You are Overmind's execution worker. You modify codebases by calling tools.

You MUST respond with ONLY a JSON object on each turn. No prose, no markdown.

Available tools:

1. read_file — read a file's contents
   {"tool": "read_file", "args": {"path": "src/index.ts"}}

2. write_file — create or overwrite a file
   {"tool": "write_file", "args": {"path": "src/index.ts", "content": "file content here"}}

3. list_files — list all available file paths
   {"tool": "list_files", "args": {}}

4. finish — end the task and report what you did
   {"tool": "finish", "args": {"summary": "Added login endpoint"}}

Workflow:
- First, use list_files or read_file to understand the codebase.
- Then, use write_file to make changes.
- Finally, call finish with a summary of what you changed.

Respond with exactly one JSON tool call per turn. No extra text.\
"""


def build_agent_user_message(req: RunCreateRequest) -> str:
    file_list = ", ".join(sorted(req.files.keys())) if req.files else "(no files)"
    scope_str = ", ".join(req.scope) if req.scope else "(all files)"
    return (
        f"Story: {req.story}\n"
        f"Scope: {scope_str}\n"
        f"Available files: {file_list}\n\n"
        f"Task: {req.prompt}"
    )


MAX_TOOL_RESULT_CHARS = 12000


def execute_tool(
    name: str, args: dict[str, str], req_files: dict[str, str], workspace: dict[str, str]
) -> str:
    if name == "read_file":
        path = args.get("path", "")
        if path in workspace:
            content = workspace[path]
        elif path in req_files:
            content = req_files[path]
        else:
            return f"Error: file not found: {path}"
        if len(content) > MAX_TOOL_RESULT_CHARS:
            return content[:MAX_TOOL_RESULT_CHARS] + f"\n... (truncated, {len(content)} total chars)"
        return content
    elif name == "write_file":
        path = args.get("path", "")
        content = args.get("content", "")
        workspace[path] = content
        return f"OK: wrote {len(content)} chars to {path}"
    elif name == "list_files":
        all_paths = sorted(set(list(req_files.keys()) + list(workspace.keys())))
        return "\n".join(all_paths) if all_paths else "(no files)"
    elif name == "finish":
        return args.get("summary", "")
    else:
        return f"Error: unknown tool: {name}"


def parse_tool_call(content: str) -> ToolCall:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9]*\n?", "", cleaned)
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    start = cleaned.find("{")
    if start == -1:
        raise ValueError(f"No JSON object in model response: {cleaned[:200]}")
    end = cleaned.rfind("}")
    if end == -1:
        raise ValueError(f"No closing brace in model response: {cleaned[:200]}")
    parsed = json.loads(cleaned[start : end + 1])
    return ToolCall(tool=parsed["tool"], args=parsed.get("args", {}))


async def read_run_record(run_id: str) -> RunStatusRecord:
    """
    Load a run record from the Modal dictionary.
    Does not create missing records.
    Edge cases: Raises KeyError if run is missing.
    Invariants: Returned record is schema-validated.
    """
    raw = await run_store.get.aio(run_id)
    if raw is None:
        raise KeyError(f"run not found: {run_id}")
    if hasattr(RunStatusRecord, "model_validate"):
        return RunStatusRecord.model_validate(raw)
    return RunStatusRecord.parse_obj(raw)


def run_record_to_dict(record: RunStatusRecord) -> dict[str, Any]:
    """
    Convert a run record to a plain dict, omitting None values.
    Does not mutate the input record.
    Edge cases: Supports both Pydantic v1 and v2 APIs.
    Invariants: Output is JSON-serializable with no null values.
    """
    if hasattr(record, "model_dump"):
        return record.model_dump(exclude_none=True)
    return {k: v for k, v in record.dict().items() if v is not None}


async def write_run_record(run_id: str, record: RunStatusRecord) -> None:
    """
    Persist a run record to the Modal dictionary.
    Does not mutate the input record.
    Edge cases: Overwrites any existing entry.
    Invariants: Stored records include updatedAt.
    """
    await run_store.put.aio(run_id, run_record_to_dict(record))


async def update_run_record(run_id: str, updates: dict[str, Any]) -> None:
    """
    Update an existing run record with new fields.
    Does not create records when missing.
    Edge cases: Raises KeyError if run is missing.
    Invariants: updatedAt is always refreshed.
    """
    record = await read_run_record(run_id)
    data = run_record_to_dict(record)
    data.update(updates)
    data["updatedAt"] = now_iso()
    await write_run_record(run_id, RunStatusRecord(**data))


async def should_cancel(run_id: str) -> bool:
    """
    Determine if a run has been canceled.
    Does not mutate run state.
    Edge cases: Missing runs return False.
    Invariants: Canceled status is treated as terminal.
    """
    try:
        record = await read_run_record(run_id)
    except KeyError:
        return False
    return record.status == STATUS_CANCELED


async def mark_run_running(run_id: str) -> None:
    """
    Mark a run as running with the working stage.
    Does not validate run existence.
    Edge cases: Missing runs raise KeyError.
    Invariants: Stage is set to STAGE_WORKING.
    """
    await update_run_record(
        run_id,
        {
            "status": STATUS_RUNNING,
            "stage": STAGE_WORKING,
            "detail": None,
            "error": None,
        },
    )


async def mark_run_canceled(run_id: str, detail: str) -> None:
    """
    Mark a run as canceled with a detail message.
    Does not terminate running workers.
    Edge cases: Missing runs raise KeyError.
    Invariants: Status is set to STATUS_CANCELED.
    """
    await update_run_record(
        run_id,
        {
            "status": STATUS_CANCELED,
            "stage": None,
            "detail": detail,
        },
    )


async def mark_run_failed(run_id: str, stage: str, detail: str, error: str) -> None:
    """
    Mark a run as failed with detail and error.
    Does not retry failed executions.
    Edge cases: Missing runs raise KeyError.
    Invariants: Status is set to STATUS_FAILED.
    """
    await update_run_record(
        run_id,
        {
            "status": STATUS_FAILED,
            "stage": stage,
            "detail": detail,
            "error": error,
        },
    )


async def mark_run_completed(run_id: str, result: AgentResult) -> None:
    """
    Mark a run as completed with extracted files and summary.
    Does not mutate the AgentResult object.
    Edge cases: Missing runs raise KeyError.
    Invariants: Status is set to STATUS_COMPLETED.
    """
    await update_run_record(
        run_id,
        {
            "status": STATUS_COMPLETED,
            "stage": STAGE_EXTRACTING,
            "files": result.files,
            "summary": result.summary,
        },
    )


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
            tool_call = parse_tool_call(content)
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


def chunk_file(path: str, content: str, chunk_size: int = 50) -> list[dict]:
    """
    Split a file's content into chunks of `chunk_size` lines.
    Does not include chunks that are purely whitespace.
    Edge cases: empty files produce no chunks; partial trailing groups are included.
    """
    lines = content.split("\n")
    chunks: list[dict] = []
    for i in range(0, len(lines), chunk_size):
        group = lines[i : i + chunk_size]
        chunk_text = "\n".join(group)
        if not chunk_text.strip():
            continue
        start_line = i + 1  # 1-indexed
        end_line = i + len(group)
        chunk_name = f"{path}:{start_line}"
        chunks.append(
            {
                "path": path,
                "chunk_name": chunk_name,
                "chunk_text": chunk_text,
                "start_line": start_line,
                "end_line": end_line,
            }
        )
    return chunks


def average_vectors(vectors: list[list[float]]) -> list[float]:
    """
    Compute element-wise average of a list of float vectors.
    Does not mutate inputs.
    Edge cases: raises ValueError if vectors is empty or vectors have different lengths.
    """
    if not vectors:
        raise ValueError("average_vectors: empty list")
    dim = len(vectors[0])
    total = [0.0] * dim
    for vec in vectors:
        for j, v in enumerate(vec):
            total[j] += v
    n = len(vectors)
    return [x / n for x in total]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Compute cosine similarity between two vectors.
    Does not mutate inputs.
    Edge cases: returns 0.0 if either vector has zero magnitude.
    """
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


async def _generate_embedding(text: str) -> list[float]:
    """
    Generate a text embedding via the LocalEmbedder Modal class.
    Does not cache results.
    Edge cases: raises on Modal/GPU errors; callers should wrap in try/except.
    """
    try:
        from modal import Cls
        LocalEmbedder = Cls.from_name(APP_NAME, "LocalEmbedder")
        embedder = LocalEmbedder()
        result = await embedder.embed.aio(text)
        return result
    except Exception:
        raise


@web_app.post("/initialize_codebase")
async def initialize_codebase(req: InitializeCodebaseRequest) -> InitializeCodebaseResponse:
    """
    Chunk and embed all files for a project, then store them in the DB.

    What it does:
      - Splits each file into 50-line chunks.
      - Generates embeddings for each chunk via LocalEmbedder.
      - Computes a centroid for the new project and checks for an existing
        project with cosine similarity > 0.97; if found, reuses that project_id.
      - Upserts a branch record and inserts code_chunks rows (ON CONFLICT DO NOTHING).

    What it does NOT do:
      - It does not delete old chunks; re-runs only add new ones.
      - It does not validate that file paths are safe or within a repo root.
      - It does not de-duplicate chunks within a single request.

    Edge cases:
      - If the embedding service is unavailable, returns 503.
      - If the DB is unavailable (db_pool is None), returns 503.
      - If a project with very similar embeddings already exists, the returned
        resolvedProjectId will differ from req.projectId.
      - Empty or whitespace-only files produce zero chunks and are skipped.
    """
    global db_pool

    log(
        f"initialize_codebase: projectId={req.projectId} "
        f"branch={req.branchName} files={len(req.files)}"
    )

    # Step 1 — Guard: DB required
    if db_pool is None:
        raise HTTPException(status_code=503, detail="database not connected")

    # Step 2 — Chunk all files
    all_chunks: list[dict] = []
    file_hashes: dict[str, str] = {}
    for path, content in req.files.items():
        file_hashes[path] = hashlib.md5(content.encode()).hexdigest()
        all_chunks.extend(chunk_file(path, content))

    if not all_chunks:
        # Nothing to embed; still upsert branch and return.
        try:
            async with db_pool.acquire() as conn:
                async with conn.transaction():
                    row = await conn.fetchrow(
                        """
                        INSERT INTO branches (name, project_id)
                        VALUES ($1, $2)
                        ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
                        RETURNING branch_id
                        """,
                        req.branchName,
                        req.projectId,
                    )
            return InitializeCodebaseResponse(
                resolvedProjectId=req.projectId,
                branchId=str(row["branch_id"]),
                chunksStored=0,
            )
        except Exception as exc:
            log(f"initialize_codebase: DB error (no chunks path): {exc}")
            raise HTTPException(status_code=500, detail="database error")

    # Step 3 — Generate embeddings for all chunks
    embeddings: list[list[float]] = []
    try:
        for chunk in all_chunks:
            emb = await _generate_embedding(chunk["chunk_text"])
            embeddings.append(emb)
    except Exception as exc:
        log(f"initialize_codebase: embedding error: {exc}")
        raise HTTPException(status_code=503, detail="embedding service unavailable")

    # Step 4 — Compute centroid of new project's embeddings
    new_centroid = average_vectors(embeddings)

    # Step 5 — Check for similar existing project
    resolved_project_id = req.projectId
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT project_id, embedding FROM code_chunks WHERE project_id != $1 LIMIT 500",
                req.projectId,
            )
    except Exception as exc:
        log(f"initialize_codebase: DB similarity query error: {exc}")
        raise HTTPException(status_code=500, detail="database error")

    if rows:
        # Group embeddings by project_id
        project_embeddings: dict[str, list[list[float]]] = {}
        for row in rows:
            pid = row["project_id"]
            raw_emb = row["embedding"]
            # asyncpg returns pgvector as a string like "[0.1,0.2,...]"
            if isinstance(raw_emb, str):
                parsed_emb = [float(x) for x in raw_emb.strip("[]").split(",")]
            else:
                parsed_emb = list(raw_emb)
            project_embeddings.setdefault(pid, []).append(parsed_emb)

        best_sim = 0.0
        best_pid = None
        for pid, vecs in project_embeddings.items():
            try:
                centroid = average_vectors(vecs)
                sim = cosine_similarity(new_centroid, centroid)
                if sim > best_sim:
                    best_sim = sim
                    best_pid = pid
            except Exception:
                continue

        SIMILARITY_THRESHOLD = 0.97
        if best_pid is not None and best_sim > SIMILARITY_THRESHOLD:
            resolved_project_id = best_pid
            log(
                f"initialize_codebase: resolving projectId={req.projectId} "
                f"→ existing={resolved_project_id} similarity={best_sim:.4f}"
            )

    # Step 6 — Upsert or find branch record
    # Step 7 — Upsert code chunks (in one transaction)
    chunks_stored_count = 0
    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO branches (name, project_id)
                    VALUES ($1, $2)
                    ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
                    RETURNING branch_id
                    """,
                    req.branchName,
                    resolved_project_id,
                )
                branch_id = row["branch_id"]

                for chunk, embedding in zip(all_chunks, embeddings):
                    emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                    file_hash = file_hashes[chunk["path"]]
                    result = await conn.execute(
                        """
                        INSERT INTO code_chunks
                            (project_id, branch_id, file_path, file_hash,
                             chunk_text, chunk_name, start_line, end_line, embedding)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
                        ON CONFLICT DO NOTHING
                        """,
                        resolved_project_id,
                        branch_id,
                        chunk["path"],
                        file_hash,
                        chunk["chunk_text"],
                        chunk["chunk_name"],
                        chunk["start_line"],
                        chunk["end_line"],
                        emb_str,
                    )
                    # asyncpg returns "INSERT 0 N" string; count inserted rows
                    if result and result.startswith("INSERT"):
                        parts = result.split()
                        if len(parts) >= 3:
                            chunks_stored_count += int(parts[2])
    except Exception as exc:
        log(f"initialize_codebase: DB upsert error: {exc}")
        raise HTTPException(status_code=500, detail="database error")

    # Step 8 — Return response
    return InitializeCodebaseResponse(
        resolvedProjectId=resolved_project_id,
        branchId=str(branch_id),
        chunksStored=chunks_stored_count,
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
