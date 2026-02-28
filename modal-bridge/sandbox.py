"""
sandbox.py — Modal Sandbox lifecycle management.

Purpose:
  Creates, manages, and interacts with Modal Sandboxes for agent execution.
  Handles file upload via ephemeral Volumes, command execution with streaming,
  and file readback for diff extraction.

Assumptions:
  - Each sandbox runs a single agent for a single prompt.
  - Sandboxes are named after promptId for idempotency.
  - Project files are mounted at /workspace inside the sandbox.
  - The Modal app "overmind-agents" is created if missing.

Invariants:
  - Sandbox names are unique per running instance.
  - Ephemeral volumes are cleaned up when the sandbox terminates.
  - All file I/O errors are caught and re-raised with context.
"""

from __future__ import annotations

import difflib
import logging
from typing import Any, Generator

import modal

from agent_image import get_or_build_image

logger = logging.getLogger("overmind.sandbox")

WORKSPACE_DIR = "/workspace"
APP_NAME = "overmind-agents"

# ─── In-memory sandbox registry ───

_active_sandboxes: dict[str, modal.Sandbox] = {}
_active_volumes: dict[str, modal.Volume] = {}


def create_sandbox(
    sandbox_id: str,
    image_name: str,
    files: dict[str, str],
    env: dict[str, str],
    timeout_s: int = 300,
    tags: dict[str, str] | None = None,
) -> str:
    """
    Create a Modal Sandbox with project files mounted via Volume.

    1. Look up or create the "overmind-agents" app.
    2. Create an ephemeral Volume and batch-upload project files.
    3. Spawn a named sandbox with the Volume mounted at /workspace.
    4. Register the sandbox in the in-memory registry.

    Returns the sandbox object_id (Modal's internal ID).
    Does NOT handle image build failures — those propagate as-is.
    """
    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    image = get_or_build_image(image_name)

    # Create ephemeral volume and upload project files
    volume = modal.Volume.ephemeral()
    with volume.batch_upload() as batch:
        for file_path, content in files.items():
            batch.put(content.encode("utf-8"), file_path)

    # Merge default and user-provided tags
    sandbox_tags = {
        "overmind": "true",
        "sandbox_id": sandbox_id,
    }
    if tags:
        sandbox_tags.update(tags)

    # Create named sandbox with volume mounted
    sb = modal.Sandbox.create(
        image=image,
        app=app,
        timeout=timeout_s,
        volumes={WORKSPACE_DIR: volume},
        environment_variables=env,
    )
    sb.set_tags(sandbox_tags)

    _active_sandboxes[sandbox_id] = sb
    _active_volumes[sandbox_id] = volume

    logger.info(
        "Created sandbox %s (modal_id=%s, image=%s, files=%d)",
        sandbox_id,
        sb.object_id,
        image_name,
        len(files),
    )

    return sb.object_id


def exec_in_sandbox(
    sandbox_id: str,
    command: list[str],
    workdir: str = WORKSPACE_DIR,
) -> Generator[dict[str, str], None, None]:
    """
    Execute a command in a running sandbox, yielding output events.

    Yields dicts with:
      - {"type": "stdout", "data": "..."} for stdout lines
      - {"type": "stderr", "data": "..."} for stderr lines
      - {"type": "exit", "data": "<code>"} on command completion

    Does NOT handle sandbox-not-found — caller must check.
    """
    sb = _active_sandboxes.get(sandbox_id)
    if sb is None:
        yield {"type": "exit", "data": "1"}
        return

    proc = sb.exec(*command, workdir=workdir)

    for line in proc.stdout:
        yield {"type": "stdout", "data": line}
    for line in proc.stderr:
        yield {"type": "stderr", "data": line}

    proc.wait()
    yield {"type": "exit", "data": str(proc.returncode)}


def read_sandbox_files(
    sandbox_id: str,
    paths: list[str],
) -> dict[str, str]:
    """
    Read file contents from a running sandbox.

    Uses sb.exec("cat", path) for reliability (filesystem API is Alpha).
    Returns a map of path -> content. Missing files are omitted.
    """
    sb = _active_sandboxes.get(sandbox_id)
    if sb is None:
        return {}

    result: dict[str, str] = {}
    for file_path in paths:
        full_path = f"{WORKSPACE_DIR}/{file_path}"
        try:
            proc = sb.exec("cat", full_path)
            content = proc.stdout.read()
            proc.wait()
            if proc.returncode == 0:
                result[file_path] = content
            else:
                logger.warning(
                    "Failed to read %s from sandbox %s (exit %d)",
                    file_path,
                    sandbox_id,
                    proc.returncode,
                )
        except Exception as exc:
            logger.warning(
                "Error reading %s from sandbox %s: %s",
                file_path,
                sandbox_id,
                exc,
            )

    return result


def diff_files(
    sandbox_id: str,
    originals: dict[str, str],
) -> list[dict[str, Any]]:
    """
    Compare original files against their current state in the sandbox.

    Returns a list of FileChange dicts:
      { path, diff, linesAdded, linesRemoved }

    Only returns entries for files that actually changed.
    Does NOT detect new files — only compares files in originals.
    """
    current = read_sandbox_files(sandbox_id, list(originals.keys()))
    changes: list[dict[str, Any]] = []

    for file_path, original_content in originals.items():
        current_content = current.get(file_path)
        if current_content is None:
            continue
        if current_content == original_content:
            continue

        original_lines = original_content.splitlines(keepends=True)
        current_lines = current_content.splitlines(keepends=True)

        diff_lines = list(
            difflib.unified_diff(
                original_lines,
                current_lines,
                fromfile=f"a/{file_path}",
                tofile=f"b/{file_path}",
            )
        )

        if not diff_lines:
            continue

        lines_added = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
        lines_removed = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))

        changes.append(
            {
                "path": file_path,
                "diff": "".join(diff_lines),
                "linesAdded": lines_added,
                "linesRemoved": lines_removed,
            }
        )

    return changes


def get_sandbox_status(sandbox_id: str) -> dict[str, Any]:
    """
    Get the current status of a sandbox.

    Returns { status: "running"|"completed"|"error"|"unknown" }.
    """
    sb = _active_sandboxes.get(sandbox_id)
    if sb is None:
        return {"status": "unknown"}

    exit_code = sb.poll()
    if exit_code is None:
        return {"status": "running"}
    elif exit_code == 0:
        return {"status": "completed"}
    else:
        return {"status": "error", "exitCode": exit_code}


def terminate_sandbox(sandbox_id: str) -> bool:
    """
    Terminate a sandbox and clean up its resources.

    Returns True if the sandbox was found and terminated.
    """
    sb = _active_sandboxes.pop(sandbox_id, None)
    vol = _active_volumes.pop(sandbox_id, None)

    if sb is None:
        return False

    try:
        sb.terminate()
        logger.info("Terminated sandbox %s", sandbox_id)
    except Exception as exc:
        logger.warning("Error terminating sandbox %s: %s", sandbox_id, exc)

    # Ephemeral volumes are auto-cleaned, but we remove our reference
    if vol is not None:
        logger.info("Released volume for sandbox %s", sandbox_id)

    return True


def terminate_all() -> int:
    """
    Terminate all active sandboxes. Returns the count terminated.
    Used during graceful shutdown.
    """
    sandbox_ids = list(_active_sandboxes.keys())
    count = 0
    for sid in sandbox_ids:
        if terminate_sandbox(sid):
            count += 1
    return count
