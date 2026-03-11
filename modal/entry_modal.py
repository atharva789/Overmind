"""
Purpose: Modal-specific deployment entry point for the Overmind orchestrator.
High-level behavior: Declares the Modal App, image, secrets, and ASGI wrapper.
  Imports the provider-agnostic orchestrator and wires worker spawning.
Assumptions: OVERMIND_LLM_AUTH and OVERMIND_SUPABASE_DB secrets exist in Modal.
  RUN_STORE_BACKEND defaults to "modal" in this entry point.
Invariants: No business logic lives here — only Modal deployment scaffolding.
  The web_app and run_worker come entirely from orchestrator.py.
"""

from __future__ import annotations

import modal

from orchestrator import RunCreateRequest, run_worker, web_app
from run_store import RunStatusRecord, STATUS_QUEUED, STAGE_SPAWNING, write_run_record
from utils import now_iso, log

# ─── Modal image & app ───────────────────────────────────────────────────────

image = modal.Image.debian_slim().pip_install(
    "fastapi",
    "httpx",
    "asyncpg",
    "openai",
    "sentence-transformers",
)

app = modal.App("overmind-orchestrator")

LLM_SECRET_NAME = "overmind-llm-auth"
DB_SECRET_NAME = "overmind-supabase-db"

# ─── Modal worker function ───────────────────────────────────────────────────


@app.function(
    image=image,
    secrets=[modal.Secret.from_name(LLM_SECRET_NAME)],
    timeout=3600,
)
async def modal_run_worker(run_id: str, req: RunCreateRequest) -> None:
    """
    Modal wrapper around run_worker.
    Spawned by create_run_modal; runs inside a Modal container.
    Does not write to the host filesystem.
    Invariants: Updates run status on all exit paths (delegated to run_worker).
    """
    await run_worker(run_id, req)


# ─── Modal-aware create_run override ────────────────────────────────────────


@web_app.post("/runs/modal")
async def create_run_modal(req: RunCreateRequest) -> dict[str, str]:
    """
    Create a run and spawn it in a Modal container.
    Use this endpoint instead of /runs when running on Modal.
    Edge cases: Rejects duplicate run IDs (delegated to run_store).
    Invariants: Worker is spawned asynchronously; caller gets runId immediately.
    """
    from run_store import run_exists
    from fastapi import HTTPException

    if await run_exists(req.runId):
        raise HTTPException(status_code=409, detail="run already exists")

    log(f"create_run_modal: runId={req.runId} files={len(req.files)}")

    await write_run_record(
        req.runId,
        RunStatusRecord(status=STATUS_QUEUED, stage=STAGE_SPAWNING, updatedAt=now_iso()),
    )
    await modal_run_worker.spawn.aio(req.runId, req)
    return {"runId": req.runId}


# ─── ASGI mount ─────────────────────────────────────────────────────────────


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name(LLM_SECRET_NAME),
        modal.Secret.from_name(DB_SECRET_NAME),
    ],
)
@modal.asgi_app()
def fastapi_app() -> object:
    """
    Expose web_app via Modal's ASGI runner.
    Does not mutate application state.
    Invariants: Returns the shared FastAPI web_app instance.
    """
    return web_app
