"""
Purpose: Orchestrate Overmind execution runs via Modal workers.
High-level behavior: Creates runs, spawns workers, and serves run status.
Assumptions: OVERMIND_LLM_URL points to a vLLM OpenAI-compatible API.
Invariants: Handlers never generate edits; workers produce all file updates.
"""

from __future__ import annotations

import json
import os
import re
import traceback
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import modal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ValidationError

APP_NAME = "overmind-orchestrator"
RUN_STORE_NAME = "overmind-orchestrator-runs"
DEFAULT_LLM_URL = "https://atharva789--overmind-llm-llmserver-serve.modal.run"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_URL = os.environ.get("OVERMIND_LLM_URL", DEFAULT_LLM_URL).rstrip("/")
LLM_TIMEOUT_S = int(os.environ.get("OVERMIND_LLM_TIMEOUT_S", "3600"))
LOG_TRUNCATE_CHARS = 1000
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


class LlmResponse(BaseModel):
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


def build_system_prompt() -> str:
    """
    Build the system prompt for deterministic JSON output.
    Does not depend on runtime state.
    Edge cases: None.
    Invariants: Returns a single-line instruction string.
    """
    return (
        "You are Overmind's execution worker. "
        "Return only JSON with keys: summary, files. "
        "Each file entry must include path and content. "
        "Do not include markdown or explanations."
    )


def build_user_prompt(req: RunCreateRequest) -> str:
    """
    Build the user prompt with story, scope, and file pack.
    Does not log prompt content.
    Edge cases: Missing scope yields an empty array.
    Invariants: JSON output is sorted for deterministic ordering.
    """
    payload = {
        "prompt": req.prompt,
        "promptId": req.promptId,
        "story": req.story,
        "scope": req.scope or [],
        "files": req.files,
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def strip_code_fences(text: str) -> str:
    """
    Remove surrounding markdown code fences if present.
    Does not alter inner JSON content.
    Edge cases: Returns trimmed input when no fences are present.
    Invariants: Output contains no leading or trailing whitespace.
    """
    trimmed = text.strip()
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```[a-zA-Z0-9]*\n?", "", trimmed)
        if trimmed.endswith("```"):
            trimmed = trimmed[: -3]
    return trimmed.strip()


def extract_json_object(text: str) -> str:
    """
    Extract the first top-level JSON object from text that may contain prose.
    Finds the first '{' and matches it to its closing '}' respecting nesting.
    Edge cases: Raises ValueError if no JSON object is found.
    Invariants: Returns a string starting with '{' and ending with '}'.
    """
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in LLM output")
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            if in_string:
                escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise ValueError("Unterminated JSON object in LLM output")


def validate_llm_response(payload: Any) -> LlmResponse:
    """
    Validate the LLM JSON output against the response schema.
    Does not coerce invalid types.
    Edge cases: Raises ValidationError on mismatch.
    Invariants: Returned object conforms to LlmResponse.
    """
    if hasattr(LlmResponse, "model_validate"):
        return LlmResponse.model_validate(payload)
    return LlmResponse.parse_obj(payload)


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
    Convert a run record to a plain dict.
    Does not mutate the input record.
    Edge cases: Supports both Pydantic v1 and v2 APIs.
    Invariants: Output is JSON-serializable.
    """
    if hasattr(record, "model_dump"):
        return record.model_dump()
    return record.dict()


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


async def mark_run_completed(run_id: str, result: LlmResponse) -> None:
    """
    Mark a run as completed with extracted files and summary.
    Does not mutate the LlmResponse object.
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


async def call_llm(req: RunCreateRequest) -> LlmResponse:
    """
    Call the vLLM OpenAI-compatible server and parse the response.
    Does not log prompt content.
    Edge cases: Raises on HTTP or JSON parse failures.
    Invariants: Returns a validated LlmResponse object.
    """
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": MODEL_ID,
        "messages": [
            {"role": "system", "content": build_system_prompt()},
            {"role": "user", "content": build_user_prompt(req)},
        ],
        "temperature": 0,
        "top_p": 1,
        "seed": 0,
    }

    url = f"{LLM_URL}/v1/chat/completions"
    user_prompt_len = len(build_user_prompt(req))
    log(f"call_llm: POST {url} model={MODEL_ID} prompt_len={user_prompt_len}")

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT_S) as client:
        response = await client.post(url, headers=headers, json=payload)
        log(f"call_llm: response status={response.status_code}")
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices")
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response missing content")

    log(f"call_llm: raw content ({len(content)} chars): {content[:500]}")

    cleaned = strip_code_fences(content)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        log(f"call_llm: direct JSON parse failed, attempting JSON extraction")
        try:
            extracted = extract_json_object(cleaned)
            parsed = json.loads(extracted)
            log(f"call_llm: extracted JSON successfully ({len(extracted)} chars)")
        except (ValueError, json.JSONDecodeError) as exc:
            log(f"call_llm: JSON extraction also failed: {exc} | cleaned[:200]={cleaned[:200]}")
            raise

    result = validate_llm_response(parsed)
    log(f"call_llm: valid response summary_len={len(result.summary)} files={len(result.files)}")
    return result


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
        result = await call_llm(req)
    except (ValidationError, json.JSONDecodeError, ValueError) as exc:
        log(f"run_worker: run_id={run_id} parse/validation error:\n{traceback.format_exc()}")
        await mark_run_failed(
            run_id,
            STAGE_EXTRACTING,
            "Invalid LLM response.",
            str(exc),
        )
        return
    except Exception as exc:
        log(f"run_worker: run_id={run_id} execution error:\n{traceback.format_exc()}")
        await mark_run_failed(
            run_id,
            STAGE_WORKING,
            "LLM execution failed.",
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
