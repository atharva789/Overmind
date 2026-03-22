"""Session: per-run event queue for real-time streaming to frontend."""

import asyncio
import json
import logging
from typing import AsyncGenerator

from stream_events import StreamEvent, RunComplete, RunError

logger = logging.getLogger(__name__)

# Active sessions keyed by run_id
_sessions: dict[str, "Session"] = {}


class Session:
    """Holds an asyncio.Queue that agent_loop/subagent_loop push events into.

    Lifecycle:
      1. POST /runs              → create_session(run_id)
      2. WS /runs/{run_id}/ws    → session.subscribe() drains the queue
      3. RunComplete or RunError → subscriber returns, WS closes
      4. Cleanup via close()
    """

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self.queue: asyncio.Queue[StreamEvent] = asyncio.Queue()
        self.closed = False

    def emit(self, event: StreamEvent) -> None:
        """Fire-and-forget push. Safe to call from any coroutine in the loop."""
        if not self.closed:
            logger.info(
                "[real-time-tag] run_id=%s event=%s",
                self.run_id,
                json.dumps(event.model_dump(), default=str),
            )
            self.queue.put_nowait(event)

    async def subscribe(self) -> AsyncGenerator[StreamEvent, None]:
        """Yields events until a terminal event (RunComplete/RunError)."""
        while True:
            event = await self.queue.get()
            yield event
            if isinstance(event, (RunComplete, RunError)):
                return

    def close(self) -> None:
        self.closed = True


def create_session(run_id: str) -> Session:
    session = Session(run_id)
    _sessions[run_id] = session
    return session


def get_session(run_id: str) -> Session | None:
    return _sessions.get(run_id)


def close_session(run_id: str) -> None:
    session = _sessions.pop(run_id, None)
    if session:
        session.close()
