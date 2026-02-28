"""
bridge.py — FastAPI HTTP server for Modal Sandbox management.

Purpose:
  Translates HTTP requests from the Overmind Node/TS server into Modal
  Python SDK calls. Runs as a local child process of the Overmind server.

Assumptions:
  - Single-instance process (one bridge per Overmind server).
  - Modal credentials are in the environment (MODAL_TOKEN_ID / SECRET).
  - Bridge port defaults to 8377 (configurable via --port).

Invariants:
  - All endpoints validate input before processing.
  - SSE streams are used for exec output (never polling).
  - Sandbox IDs in the HTTP API are our internal IDs, not Modal's.
  - Bridge never stores prompt content — only sandbox metadata.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sandbox import (
    create_sandbox,
    diff_files,
    exec_in_sandbox,
    get_sandbox_status,
    read_sandbox_files,
    terminate_all,
    terminate_sandbox,
)

# ─── Logging ───

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("overmind.bridge")

# ─── App ───

app = FastAPI(title="Overmind Modal Bridge", version="0.1.0")


# ─── Request/Response Models ───


class CreateSandboxRequest(BaseModel):
    """Request body for POST /sandbox/create."""
    sandbox_id: str
    image: str = "base"
    files: dict[str, str] = {}
    env: dict[str, str] = {}
    timeout_s: int = 300
    tags: dict[str, str] | None = None


class CreateSandboxResponse(BaseModel):
    """Response for POST /sandbox/create."""
    sandbox_id: str
    modal_id: str


class ExecRequest(BaseModel):
    """Request body for POST /sandbox/{id}/exec."""
    command: list[str]
    workdir: str = "/workspace"
    stream: bool = True


class FilesRequest(BaseModel):
    """Query parameters for GET /sandbox/{id}/files."""
    paths: list[str]


class DiffRequest(BaseModel):
    """Request body for POST /sandbox/{id}/diff."""
    originals: dict[str, str]


class StatusResponse(BaseModel):
    """Response for GET /sandbox/{id}/status."""
    status: str
    exit_code: int | None = None


class HealthResponse(BaseModel):
    """Response for GET /health."""
    status: str
    modal_connected: bool


# ─── Endpoints ───


@app.post("/sandbox/create", response_model=CreateSandboxResponse)
async def endpoint_create_sandbox(req: CreateSandboxRequest) -> dict[str, Any]:
    """
    Create a Modal Sandbox with project files.

    Uploads files via ephemeral Volume, spawns sandbox with
    the specified image and environment variables.
    """
    try:
        modal_id = create_sandbox(
            sandbox_id=req.sandbox_id,
            image_name=req.image,
            files=req.files,
            env=req.env,
            timeout_s=req.timeout_s,
            tags=req.tags,
        )
        return {"sandbox_id": req.sandbox_id, "modal_id": modal_id}
    except Exception as exc:
        logger.error("Failed to create sandbox %s: %s", req.sandbox_id, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/sandbox/{sandbox_id}/exec")
async def endpoint_exec(sandbox_id: str, req: ExecRequest) -> StreamingResponse:
    """
    Execute a command inside a running sandbox.

    Returns a Server-Sent Events stream of stdout, stderr, and exit events.
    Each event is a JSON object: { type, data }.
    """

    def event_stream():
        for event in exec_in_sandbox(
            sandbox_id=sandbox_id,
            command=req.command,
            workdir=req.workdir,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/sandbox/{sandbox_id}/files")
async def endpoint_get_files(
    sandbox_id: str, req: FilesRequest
) -> dict[str, Any]:
    """
    Read file contents from a running sandbox.

    Returns { files: Record<path, content> }.
    """
    files = read_sandbox_files(sandbox_id, req.paths)
    return {"files": files}


@app.post("/sandbox/{sandbox_id}/diff")
async def endpoint_diff(
    sandbox_id: str, req: DiffRequest
) -> dict[str, Any]:
    """
    Compare sandbox files against originals.

    Returns { changes: FileChange[] } where FileChange has
    path, diff, linesAdded, linesRemoved.
    """
    changes = diff_files(sandbox_id, req.originals)
    return {"changes": changes}


@app.post("/sandbox/{sandbox_id}/terminate")
async def endpoint_terminate(sandbox_id: str) -> dict[str, bool]:
    """
    Terminate a sandbox and release all resources.
    """
    success = terminate_sandbox(sandbox_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Sandbox {sandbox_id} not found",
        )
    return {"ok": True}


@app.get("/sandbox/{sandbox_id}/status", response_model=StatusResponse)
async def endpoint_status(sandbox_id: str) -> dict[str, Any]:
    """
    Get sandbox status: running, completed, error, or unknown.
    """
    result = get_sandbox_status(sandbox_id)
    return {
        "status": result["status"],
        "exit_code": result.get("exitCode"),
    }


@app.get("/health", response_model=HealthResponse)
async def endpoint_health() -> dict[str, Any]:
    """
    Health check — confirms bridge is running and Modal is reachable.

    Checks for MODAL_TOKEN_ID in environment as a proxy for connectivity.
    A full connectivity check would require an SDK call, but this
    is sufficient for startup validation.
    """
    modal_connected = bool(os.environ.get("MODAL_TOKEN_ID"))
    return {"status": "ok", "modal_connected": modal_connected}


@app.on_event("shutdown")
async def on_shutdown() -> None:
    """
    Graceful shutdown — terminate all active sandboxes.
    """
    count = terminate_all()
    logger.info("Shutdown: terminated %d sandbox(es)", count)
