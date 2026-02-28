"""
Purpose: Manage Modal sandbox lifecycle and file operations.
High-level behavior: Create sandboxes, run commands, read files.
Assumptions: Modal SDK and sandbox APIs are available.
Invariants: All file paths are scoped under /workspace.
"""

from __future__ import annotations

import difflib
import os
import shlex
from typing import Dict, Generator, Iterable

import modal

from agent_image import get_or_build_image

WORKDIR = "/workspace"


def _sandbox_path(rel_path: str) -> str:
    return os.path.join(WORKDIR, rel_path)


def _ensure_parent_dirs(sandbox: modal.Sandbox, rel_path: str) -> None:
    parent = os.path.dirname(_sandbox_path(rel_path))
    command = f"mkdir -p {shlex.quote(parent)}"
    sandbox.exec("sh", "-c", command).wait()


def _write_file(sandbox: modal.Sandbox, rel_path: str, content: str) -> None:
    _ensure_parent_dirs(sandbox, rel_path)
    target = _sandbox_path(rel_path)
    command = f"cat > {shlex.quote(target)}"
    proc = sandbox.exec("sh", "-c", command)
    proc.stdin.write(content.encode())
    proc.stdin.close()
    proc.wait()


def create_sandbox(
    image_name: str,
    files: Dict[str, str],
    env: Dict[str, str],
    timeout_s: int = 300,
) -> modal.Sandbox:
    """
    Create a Modal sandbox and upload project files.
    Does not run any commands beyond file writes.
    """
    app = modal.App.lookup("overmind-agents", create_if_missing=True)
    image = get_or_build_image(image_name)

    sandbox = modal.Sandbox.create(
        image=image,
        app=app,
        timeout=timeout_s,
        env=env,
    )

    for rel_path, content in files.items():
        _write_file(sandbox, rel_path, content)

    return sandbox


def exec_in_sandbox(
    sandbox: modal.Sandbox,
    command: Iterable[str],
    workdir: str = WORKDIR,
) -> Generator[dict, None, None]:
    """
    Execute a command inside the sandbox and stream output.
    Yields stdout/stderr lines and a final exit code.
    """
    proc = sandbox.exec(*command, workdir=workdir)

    for line in proc.stdout:
        yield {"type": "stdout", "data": line.decode().rstrip("\n")}
    for line in proc.stderr:
        yield {"type": "stderr", "data": line.decode().rstrip("\n")}

    proc.wait()
    yield {"type": "exit", "data": str(proc.returncode)}


def read_files(
    sandbox: modal.Sandbox,
    paths: Iterable[str],
) -> Dict[str, str]:
    """
    Read file contents from the sandbox.
    Returns empty string for files that cannot be read.
    """
    result: Dict[str, str] = {}
    for rel_path in paths:
        target = _sandbox_path(rel_path)
        command = f"cat {shlex.quote(target)}"
        proc = sandbox.exec("sh", "-c", command)
        output = proc.stdout.read().decode()
        proc.wait()
        result[rel_path] = output
    return result


def _count_diff_lines(diff_text: str) -> tuple[int, int]:
    added = 0
    removed = 0
    for line in diff_text.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            added += 1
        if line.startswith("-"):
            removed += 1
    return added, removed


def diff_files(
    sandbox: modal.Sandbox,
    originals: Dict[str, str],
    paths: Iterable[str],
) -> list[dict]:
    """
    Compute unified diffs for the provided paths.
    Only compares files listed in paths.
    """
    current = read_files(sandbox, paths)
    changes: list[dict] = []

    for rel_path, before in originals.items():
        after = current.get(rel_path, "")
        if before == after:
            continue
        diff_lines = difflib.unified_diff(
            before.splitlines(),
            after.splitlines(),
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            lineterm="",
        )
        diff_text = "\n".join(diff_lines)
        added, removed = _count_diff_lines(diff_text)
        changes.append(
            {
                "path": rel_path,
                "diff": diff_text,
                "linesAdded": added,
                "linesRemoved": removed,
            }
        )

    return changes
