"""
Purpose: Shared logging and timestamp utilities for all Overmind Modal modules.
High-level behavior: Provides now_iso() and log() used across orchestrator,
  codebase_store, and run_store so the implementation is not duplicated.
Assumptions: stdout is the log sink (Modal captures it per function invocation).
Invariants: log() always includes a UTC timestamp; messages are truncated to
  LOG_TRUNCATE_CHARS to prevent runaway output.
"""

from __future__ import annotations

from datetime import datetime, timezone

LOG_TRUNCATE_CHARS = 1000


def now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    """
    Print a timestamped log line to stdout.
    Does not include prompt or file content.
    Edge cases: messages longer than LOG_TRUNCATE_CHARS are truncated.
    Invariants: always prefixed with a UTC timestamp.
    """
    print(f"[{now_iso()}] {message[:LOG_TRUNCATE_CHARS]}")
