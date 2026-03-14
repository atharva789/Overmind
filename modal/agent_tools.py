"""
Purpose: Define agent tools, schemas, and execution logic for Overmind workers.
High-level behavior: Provides the system prompt, user message builder, OpenAI-
  compatible tool schemas, async handler functions, and a dispatch map used by
  the agent loop in orchestrator.py.
Assumptions: Callers pass req.files as a plain dict[str, str]. Async handlers
  receive a ctx dict containing db_pool, generate_embedding, etc.
Invariants: Pure tools (read/write/list/search/finish) only mutate workspace.
  Dangerous tools (bash, network) perform real I/O. Semantic search queries
  the vector DB via the ctx-provided pool.
"""

from __future__ import annotations

import asyncio
import fnmatch
import re
from typing import TYPE_CHECKING, Any, Callable, Coroutine

if TYPE_CHECKING:
    from orchestrator import RunCreateRequest

AGENT_SYSTEM_PROMPT = """\
You are Overmind's execution worker. You modify codebases by calling tools.

Workflow:
1. Use list_files to see available files.
2. Use semantic_search to find code by meaning, or search_files for exact patterns.
3. Use read_file to understand relevant code.
4. Use run_bash to install dependencies, run tests, or execute scripts.
5. Use run_network to fetch data from APIs or download resources.
6. Use write_file to make changes.
7. Call subagent_finished with a summary of what you changed.

Guidelines:
- Always read a file before modifying it.
- Make focused, minimal changes.
- Preserve existing code style and formatting.\
"""


# ─── OpenAI tool-calling schemas ─────────────────────────────────────────────

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "planner_finished",
            "description": (
                "Signal that the planner has finished aggregating all sub-agents' outputs."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Final summary of all subagent changes and the overall result.",
                    }
                },
                "required": ["summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft-plan",
            "description": "Draft an initial plan for achieving the user's overarching goal.",
            "parameters": {
                "type": "object",
                "properties": {
                    "plan": {
                        "type": "string",
                        "description": "The detailed draft plan.",
                    }
                },
                "required": ["plan"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the full contents of a file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative file path to read.",
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file with the given content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative file path to write.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete file content.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List all available file paths in the workspace.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": (
                "Search for a regex pattern across all files. "
                "Returns matching lines with file paths and line numbers."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regex pattern to search for.",
                    },
                    "glob": {
                        "type": "string",
                        "description": (
                            "Optional glob to filter file paths (e.g. '*.ts')."
                        ),
                    },
                },
                "required": ["pattern"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "semantic_search",
            "description": (
                "Search the indexed codebase using natural language. "
                "Finds semantically similar code chunks via vector embeddings "
                "(BAAI/bge-large-en-v1.5 + pgvector). Returns ranked results "
                "with similarity scores. Requires a connected database."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Natural language description of the code "
                            "you are looking for."
                        ),
                    },
                    "limit": {
                        "type": "integer",
                        "description": (
                            "Max results to return (default 5, max 20)."
                        ),
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_bash",
            "description": (
                "Execute an arbitrary bash command. "
                "Can install packages, run scripts, compile code, run tests, "
                "or perform any shell operation. No restrictions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute.",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": (
                            "Timeout in seconds (default 30, max 120)."
                        ),
                    },
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_network",
            "description": (
                "Make an arbitrary HTTP request. "
                "Can fetch APIs, download resources, post data, "
                "or interact with any web service. No restrictions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to request.",
                    },
                    "method": {
                        "type": "string",
                        "description": (
                            "HTTP method: GET, POST, PUT, DELETE, PATCH. "
                            "Default: GET."
                        ),
                    },
                    "headers": {
                        "type": "object",
                        "description": "Request headers as key-value pairs.",
                        "additionalProperties": {"type": "string"},
                    },
                    "body": {
                        "type": "string",
                        "description": (
                            "Request body (for POST, PUT, PATCH)."
                        ),
                    },
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "subagent_finished",
            "description": (
                "Signal that the subagent has completed its task. Call this when done."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Brief summary of changes made by the subagent.",
                    }
                },
                "required": ["summary"],
            },
        },
    },
]


# ─── Tool handlers (all async) ───────────────────────────────────────────────


async def _read_file(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    path = args.get("path", "")
    if path in workspace:
        return workspace[path]
    if path in req_files:
        return req_files[path]
    return f"Error: file not found: {path}"


async def _write_file(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    path = args.get("path", "")
    content = args.get("content", "")
    workspace[path] = content
    return f"OK: wrote {len(content)} chars to {path}"


async def _list_files(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    all_paths = sorted(req_files.keys() | workspace.keys())
    return "\n".join(all_paths) if all_paths else "(no files)"


async def _search_files(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    pattern_str = args.get("pattern", "")
    glob_filter = args.get("glob", "")
    all_files: dict[str, str] = {**req_files, **workspace}

    if glob_filter:
        all_files = {
            k: v
            for k, v in all_files.items()
            if fnmatch.fnmatch(k, glob_filter)
        }

    try:
        regex = re.compile(pattern_str)
    except re.error as exc:
        return f"Error: invalid regex: {exc}"

    matches: list[str] = []
    for path in sorted(all_files):
        for i, line in enumerate(all_files[path].split("\n"), 1):
            if regex.search(line):
                matches.append(f"{path}:{i}: {line}")

    return "\n".join(matches) if matches else "No matches found."


async def _semantic_search(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    query = args.get("query", "")
    limit = min(int(args.get("limit", 5)), 20)

    db_pool = ctx.get("db_pool")
    generate_embedding = ctx.get("generate_embedding")

    if db_pool is None:
        return "Error: database not connected — semantic search unavailable"
    if generate_embedding is None:
        return "Error: embedding function not available"

    try:
        embedding = await generate_embedding(query)
    except Exception as exc:
        return f"Error: embedding generation failed: {exc}"

    from utils import to_pgvector_literal
    vec_literal = to_pgvector_literal(embedding)

    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT file_path, chunk_name, chunk_text,
                       start_line, end_line,
                       1 - (embedding <=> $1::vector) AS similarity
                FROM code_chunks
                ORDER BY embedding <=> $1::vector
                LIMIT $2
                """,
                vec_literal,
                limit,
            )
    except Exception as exc:
        return f"Error: database query failed: {exc}"

    if not rows:
        return "No matching code chunks found."

    parts: list[str] = []
    for row in rows:
        sim = float(row["similarity"])
        parts.append(
            f"--- {row['chunk_name']} (similarity: {sim:.3f}) ---\n"
            f"{row['chunk_text']}"
        )
    return "\n\n".join(parts)


async def _run_bash(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    command = args.get("command", "")
    timeout_s = min(int(args.get("timeout", 30)), 120)

    if not command.strip():
        return "Error: empty command"

    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_s
        )
    except asyncio.TimeoutError:
        proc.kill()  # type: ignore[union-attr]
        return f"Error: command timed out after {timeout_s}s"
    except Exception as exc:
        return f"Error: {exc}"

    parts: list[str] = []
    if stdout:
        parts.append(f"STDOUT:\n{stdout.decode('utf-8', errors='replace')}")
    if stderr:
        parts.append(f"STDERR:\n{stderr.decode('utf-8', errors='replace')}")
    parts.append(f"EXIT CODE: {proc.returncode}")
    return "\n".join(parts)


async def _run_network(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    import httpx

    url = args.get("url", "")
    method = args.get("method", "GET").upper()
    headers = args.get("headers") or {}
    body = args.get("body", "")

    if not url:
        return "Error: url is required"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.request(
                method=method,
                url=url,
                headers=headers,
                content=body if body else None,
            )
    except Exception as exc:
        return f"Error: request failed: {exc}"

    return (
        f"STATUS: {response.status_code}\n"
        f"HEADERS:\n{dict(response.headers)}\n"
        f"BODY:\n{response.text}"
    )


async def _draft_plan(
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any],
) -> str:
    return f"Plan drafted successfully: {args.get('plan', '')}"


_AsyncToolHandler = Callable[
    [dict, dict[str, str], dict[str, str], dict[str, Any]],
    Coroutine[Any, Any, str],
]

TOOL_HANDLERS: dict[str, _AsyncToolHandler] = {
    "draft-plan": _draft_plan,
    "read_file": _read_file,
    "write_file": _write_file,
    "list_files": _list_files,
    "search_files": _search_files,
    "semantic_search": _semantic_search,
    "run_bash": _run_bash,
    "run_network": _run_network,
}


# ─── Public API ───────────────────────────────────────────────────────────────


def build_agent_user_message(req: "RunCreateRequest") -> str:
    """
    Build the initial user message for the agent from a run request.
    Does not call external services.
    Edge cases: Empty files or scope lists produce placeholder strings.
    Invariants: Always returns a non-empty string.
    """
    file_list = (
        ", ".join(sorted(req.files.keys())) if req.files else "(no files)"
    )
    scope_str = ", ".join(req.scope) if req.scope else "(all files)"
    return (
        f"Story: {req.story}\n"
        f"Scope: {scope_str}\n"
        f"Available files: {file_list}\n\n"
        f"Task: {req.prompt}"
    )


async def execute_tool(
    name: str,
    args: dict,
    req_files: dict[str, str],
    workspace: dict[str, str],
    ctx: dict[str, Any] | None = None,
) -> str:
    """
    Dispatch a tool call via the handler map and return its string result.
    Pure tools only touch req_files/workspace. Dangerous tools (bash, network)
    perform real I/O. semantic_search queries the vector DB via ctx.
    Edge cases: Unknown tool names return an error string (no exception).
    Invariants: workspace is the only dict mutated by pure tools.
    """
    handler = TOOL_HANDLERS.get(name)
    if handler is None:
        return f"Error: unknown tool: {name}"
    return await handler(args, req_files, workspace, ctx or {})
