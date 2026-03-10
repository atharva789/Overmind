"""
Purpose: Define agent tools, prompts, and tool execution logic for Overmind workers.
High-level behavior: Provides the system prompt, user message builder, tool
  definitions, and execute_tool dispatcher used by the agent agentic loop.
Assumptions: FileChange is defined in orchestrator.py; callers pass req.files
  as a plain dict[str, str] to avoid circular imports.
Invariants: execute_tool is pure with respect to external I/O; all mutations
  happen in the workspace dict passed by the caller.
"""

from __future__ import annotations

import json
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from orchestrator import RunCreateRequest

AGENT_SYSTEM_PROMPT = """\
You are Overmind's execution worker. You modify codebases by calling tools.

You MUST respond with ONLY a JSON object on each turn. No prose, no markdown.

Available tools:

1. read_file — read a file's contents
   {"tool": "read_file", "args": {"path": "src/index.ts"}}

2. write_file — create or overwrite a file
   {"tool": "write_file", "args": {"path": "src/index.ts", "content": "file content here"}}

3. list_files — list all available file paths
   {"tool": "list_files", "args": {}}

4. finish — end the task and report what you did
   {"tool": "finish", "args": {"summary": "Added login endpoint"}}

Workflow:
- First, use list_files or read_file to understand the codebase.
- Then, use write_file to make changes.
- Finally, call finish with a summary of what you changed.

Respond with exactly one JSON tool call per turn. No extra text.\
"""

MAX_TOOL_RESULT_CHARS = 12000


def build_agent_user_message(req: "RunCreateRequest") -> str:
    """
    Build the initial user message for the agent from a run request.
    Does not call external services.
    Edge cases: Empty files or scope lists produce placeholder strings.
    Invariants: Always returns a non-empty string.
    """
    file_list = ", ".join(sorted(req.files.keys())) if req.files else "(no files)"
    scope_str = ", ".join(req.scope) if req.scope else "(all files)"
    return (
        f"Story: {req.story}\n"
        f"Scope: {scope_str}\n"
        f"Available files: {file_list}\n\n"
        f"Task: {req.prompt}"
    )


def execute_tool(
    name: str,
    args: dict[str, str],
    req_files: dict[str, str],
    workspace: dict[str, str],
) -> str:
    """
    Dispatch a tool call and return its string result.
    Does not perform I/O; reads/writes only req_files and workspace dicts.
    Edge cases: Unknown tool names return an error string (no exception).
    Invariants: workspace is the only mutable argument; req_files is read-only.
    """
    if name == "read_file":
        path = args.get("path", "")
        if path in workspace:
            content = workspace[path]
        elif path in req_files:
            content = req_files[path]
        else:
            return f"Error: file not found: {path}"
        if len(content) > MAX_TOOL_RESULT_CHARS:
            return (
                content[:MAX_TOOL_RESULT_CHARS]
                + f"\n... (truncated, {len(content)} total chars)"
            )
        return content
    elif name == "write_file":
        path = args.get("path", "")
        content = args.get("content", "")
        workspace[path] = content
        return f"OK: wrote {len(content)} chars to {path}"
    elif name == "list_files":
        all_paths = sorted(set(list(req_files.keys()) + list(workspace.keys())))
        return "\n".join(all_paths) if all_paths else "(no files)"
    elif name == "finish":
        return args.get("summary", "")
    else:
        return f"Error: unknown tool: {name}"


def parse_tool_call_json(content: str) -> dict:
    """
    Extract and parse the JSON tool call from a model response string.
    Strips markdown code fences and finds the outermost JSON object.
    Edge cases: Raises ValueError if no JSON object is found or if JSON is invalid.
    Invariants: Returns a plain dict; caller must validate required keys.
    """
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9]*\n?", "", cleaned)
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()
    start = cleaned.find("{")
    if start == -1:
        raise ValueError(f"No JSON object in model response: {cleaned[:200]}")
    end = cleaned.rfind("}")
    if end == -1:
        raise ValueError(f"No closing brace in model response: {cleaned[:200]}")
    return json.loads(cleaned[start: end + 1])
