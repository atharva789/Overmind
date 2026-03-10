"""
Purpose: Manage run lifecycle records in the Modal distributed dictionary.
High-level behavior: Provides typed read/write/update helpers for RunStatusRecord
  objects stored in the Modal Dict, plus mark_* helpers for each terminal state.
Assumptions: run_store is a module-level Modal Dict instance imported here.
  Callers in orchestrator.py import the mark_* helpers directly.
Invariants: Every write refreshes updatedAt. Records are never deleted, only
  overwritten. Status transitions are enforced by callers, not this module.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import modal
from pydantic import BaseModel

RUN_STORE_NAME = "overmind-orchestrator-runs"

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELED = "canceled"

STAGE_SPAWNING = "Spawning sandbox..."
STAGE_WORKING = "Agent is working..."
STAGE_EXTRACTING = "Extracting changes..."

run_store = modal.Dict.from_name(RUN_STORE_NAME, create_if_missing=True)


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_record_to_dict(record: RunStatusRecord) -> dict[str, Any]:
    """
    Convert a RunStatusRecord to a plain dict, omitting None values.
    Does not mutate the input record.
    Edge cases: Supports both Pydantic v1 and v2 APIs.
    Invariants: Output is JSON-serializable with no null values.
    """
    if hasattr(record, "model_dump"):
        return record.model_dump(exclude_none=True)
    return {k: v for k, v in record.dict().items() if v is not None}


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
    data["updatedAt"] = _now_iso()
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
