"""
Purpose: Expose a FastAPI bridge for Modal sandbox operations.
High-level behavior: Map HTTP requests to Modal SDK calls.
Assumptions: Modal credentials are configured in the environment.
Invariants: Sandbox IDs are unique per running bridge instance.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import modal

from sandbox import (
    create_sandbox,
    diff_files,
    exec_in_sandbox,
    read_files,
)

app = FastAPI()


@dataclass
class SandboxRecord:
    sandbox: modal.Sandbox
    created_at: float


class SandboxCreateRequest(BaseModel):
    image: str
    files: Dict[str, str]
    env: Dict[str, str]
    timeout_s: int = 300


class SandboxExecRequest(BaseModel):
    command: List[str]
    workdir: Optional[str] = "/workspace"
    stream: bool = True


class SandboxDiffRequest(BaseModel):
    originals: Dict[str, str]
    paths: List[str]


SANDBOXES: Dict[str, SandboxRecord] = {}


def _get_record(sandbox_id: str) -> SandboxRecord:
    record = SANDBOXES.get(sandbox_id)
    if not record:
        raise HTTPException(status_code=404, detail="Sandbox not found")
    return record


def _sse_stream(events: Iterable[dict]) -> Iterable[str]:
    for event in events:
        payload = json.dumps(event)
        yield f"data: {payload}\n\n"


@app.get("/health")
def health() -> Dict[str, object]:
    """
    Check Modal connectivity for health status.
    Returns modal_connected=false if lookup fails.
    """
    modal_connected = True
    try:
        modal.App.lookup("overmind-agents", create_if_missing=True)
    except Exception:
        modal_connected = False

    return {"status": "ok", "modal_connected": modal_connected}


@app.post("/sandbox/create")
def sandbox_create(req: SandboxCreateRequest) -> Dict[str, str]:
    """
    Create a sandbox and upload project files.
    Returns the generated sandbox_id.
    """
    sandbox = create_sandbox(req.image, req.files, req.env, req.timeout_s)
    sandbox_id = str(uuid.uuid4())
    SANDBOXES[sandbox_id] = SandboxRecord(
        sandbox=sandbox,
        created_at=time.time(),
    )
    return {"sandbox_id": sandbox_id}


@app.post("/sandbox/{sandbox_id}/exec")
def sandbox_exec(
    sandbox_id: str,
    req: SandboxExecRequest,
) -> StreamingResponse:
    """
    Execute a command inside a sandbox and stream output.
    Always returns an SSE stream.
    """
    record = _get_record(sandbox_id)
    events = exec_in_sandbox(record.sandbox, req.command, req.workdir)
    return StreamingResponse(
        _sse_stream(events),
        media_type="text/event-stream",
    )


@app.get("/sandbox/{sandbox_id}/files")
def sandbox_files(
    sandbox_id: str,
    paths: str = Query(""),
) -> Dict[str, Dict[str, str]]:
    """
    Read files from the sandbox filesystem.
    The query param is a comma-separated list of paths.
    """
    record = _get_record(sandbox_id)
    path_list = [p for p in paths.split(",") if p]
    files = read_files(record.sandbox, path_list)
    return {"files": files}


@app.post("/sandbox/{sandbox_id}/diff")
def sandbox_diff(
    sandbox_id: str,
    req: SandboxDiffRequest,
) -> Dict[str, list]:
    """
    Diff current files against provided originals.
    Only diffs the paths in the request body.
    """
    record = _get_record(sandbox_id)
    changes = diff_files(record.sandbox, req.originals, req.paths)
    return {"changes": changes}


@app.post("/sandbox/{sandbox_id}/terminate")
def sandbox_terminate(sandbox_id: str) -> Dict[str, bool]:
    """
    Terminate a sandbox and remove it from registry.
    Does nothing if the sandbox is already gone.
    """
    record = SANDBOXES.pop(sandbox_id, None)
    if record:
        record.sandbox.terminate()
    return {"ok": True}


@app.get("/sandbox/{sandbox_id}/status")
def sandbox_status(sandbox_id: str) -> Dict[str, object]:
    """
    Return a lightweight sandbox status payload.
    Does not call Modal status APIs.
    """
    record = _get_record(sandbox_id)
    uptime_s = int(time.time() - record.created_at)
    return {"status": "running", "uptime_s": uptime_s}
