"""
Purpose: Manage run lifecycle records with a swappable storage backend.
High-level behavior: Provides typed read/write/update helpers for RunStatusRecord
  objects. Backend is selected by RUN_STORE_BACKEND env var: "modal" (default)
  uses Modal Dict; "memory" uses an in-process dict (suitable for AWS/local).
Assumptions: "modal" backend requires Modal to be installed and authenticated.
  "memory" backend loses state on process restart.
Invariants: Every write refreshes updatedAt. Records are never deleted, only
  overwritten. Status transitions are enforced by callers, not this module.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from pydantic import BaseModel

from utils import now_iso

# ─── Status / Stage constants ────────────────────────────────────────────────

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELED = "canceled"

STAGE_SPAWNING = "Spawning sandbox..."
STAGE_WORKING = "Agent is working..."
STAGE_EXTRACTING = "Extracting changes..."

# ─── Models ──────────────────────────────────────────────────────────────────


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


# ─── Backend implementations ─────────────────────────────────────────────────


class _MemoryStore:
    """In-process dict store. State is lost on restart. For AWS/local use."""

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}

    async def get(self, key: str) -> Any:
        return self._data.get(key)

    async def put(self, key: str, value: Any) -> None:
        self._data[key] = value


class _ModalStore:
    """Modal Dict store. Persists across Modal function invocations."""

    def __init__(self) -> None:
        import modal
        self._dict = modal.Dict.from_name(
            "overmind-orchestrator-runs", create_if_missing=True
        )

    async def get(self, key: str) -> Any:
        return await self._dict.get.aio(key)

    async def put(self, key: str, value: Any) -> None:
        await self._dict.put.aio(key, value)


# Lazily initialized — avoids importing modal at module scope on non-Modal hosts.
_store: "_MemoryStore | _ModalStore | None" = None


def _get_store() -> "_MemoryStore | _ModalStore":
    global _store
    if _store is None:
        backend = os.environ.get("RUN_STORE_BACKEND", "modal")
        _store = _ModalStore() if backend == "modal" else _MemoryStore()
    return _store


# ─── Public helpers ───────────────────────────────────────────────────────────


def run_record_to_dict(record: RunStatusRecord) -> dict[str, Any]:
    """
    Convert a RunStatusRecord to a plain dict, omitting None values.
    Does not mutate the input record.
    Invariants: Output is JSON-serializable.
    """
    return record.model_dump(exclude_none=True)


async def run_exists(run_id: str) -> bool:
    """Return True if a run record exists in the store."""
    return await _get_store().get(run_id) is not None


async def read_run_record(run_id: str) -> RunStatusRecord:
    """
    Load a run record from the store.
    Edge cases: Raises KeyError if run_id is missing.
    Invariants: Returned record is schema-validated.
    """
    raw = await _get_store().get(run_id)
    if raw is None:
        raise KeyError(f"run not found: {run_id}")
    return RunStatusRecord.model_validate(raw)


async def write_run_record(run_id: str, record: RunStatusRecord) -> None:
    """
    Persist a run record to the store.
    Edge cases: Overwrites any existing entry.
    Invariants: Stored records include updatedAt.
    """
    await _get_store().put(run_id, run_record_to_dict(record))


async def update_run_record(run_id: str, updates: dict[str, Any]) -> None:
    """
    Merge updates into an existing run record and persist.
    Edge cases: Raises KeyError if run_id is missing.
    Invariants: updatedAt is always refreshed.
    """
    record = await read_run_record(run_id)
    data = run_record_to_dict(record)
    data.update(updates)
    data["updatedAt"] = now_iso()
    await write_run_record(run_id, RunStatusRecord(**data))


async def should_cancel(run_id: str) -> bool:
    """
    Return True if the run has been marked canceled.
    Edge cases: Missing runs return False (not an error).
    Invariants: Canceled status is treated as terminal.
    """
    try:
        record = await read_run_record(run_id)
    except KeyError:
        return False
    return record.status == STATUS_CANCELED


# ─── State transition helpers ─────────────────────────────────────────────────


async def mark_run_running(run_id: str) -> None:
    await update_run_record(
        run_id,
        {"status": STATUS_RUNNING, "stage": STAGE_WORKING, "detail": None, "error": None},
    )


async def mark_run_canceled(run_id: str, detail: str) -> None:
    await update_run_record(
        run_id, {"status": STATUS_CANCELED, "stage": None, "detail": detail}
    )


async def mark_run_failed(run_id: str, stage: str, detail: str, error: str) -> None:
    await update_run_record(
        run_id,
        {"status": STATUS_FAILED, "stage": stage, "detail": detail, "error": error},
    )


async def mark_run_completed(run_id: str, result: AgentResult) -> None:
    await update_run_record(
        run_id,
        {
            "status": STATUS_COMPLETED,
            "stage": STAGE_EXTRACTING,
            "files": [f.model_dump() for f in result.files],
            "summary": result.summary,
        },
    )
