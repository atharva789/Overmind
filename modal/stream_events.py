"""Stream event models for real-time orchestrator → frontend communication."""

from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional

MAX_OUTPUT_CHARS = 200


def truncate(text: str, max_chars: int = MAX_OUTPUT_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "..."


# ── Base ──────────────────────────────────────────────────────────────────────

class StreamEvent(BaseModel):
    """Base for all events pushed through the Session queue."""
    event_type: str


# ── Plan ──────────────────────────────────────────────────────────────────────

class PlanReady(StreamEvent):
    event_type: str = "plan-ready"
    tasks: list[dict] = Field(description="List of {task_index, task_name, task_description}")


# ── Agents ────────────────────────────────────────────────────────────────────

class AgentSpawned(StreamEvent):
    event_type: str = "agent-spawned"
    task_index: int
    task_name: str
    task_description: str


class AgentStatus(str, Enum):
    SUCCESSFUL = "successful"
    FAILED = "failed"


class AgentFinished(StreamEvent):
    event_type: str = "agent-finished"
    task_index: int
    task_name: str
    status: AgentStatus
    files_changed: list[str] = Field(default_factory=list)
    summary: str = ""


# ── Tools ─────────────────────────────────────────────────────────────────────

class ToolUse(StreamEvent):
    event_type: str = "tool-use"
    task_index: int
    task_name: str
    tool_name: str


class ToolResult(StreamEvent):
    event_type: str = "tool-result"
    task_index: int
    task_name: str
    tool_name: str
    success: bool
    output_preview: str = ""

    @classmethod
    def from_raw(
        cls,
        task_index: int,
        task_name: str,
        tool_name: str,
        success: bool,
        raw_output: str,
    ) -> "ToolResult":
        return cls(
            task_index=task_index,
            task_name=task_name,
            tool_name=tool_name,
            success=success,
            output_preview=truncate(raw_output),
        )


# ── Run lifecycle ─────────────────────────────────────────────────────────────

class RunComplete(StreamEvent):
    event_type: str = "run-complete"
    summary: str = ""
    files: list[dict] = Field(default_factory=list)


class RunError(StreamEvent):
    event_type: str = "run-error"
    error: str
