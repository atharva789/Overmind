"""
Purpose: Orchestrate Overmind execution requests via a vLLM backend.
High-level behavior: Validates input, calls the LLM, and returns file edits.
Assumptions: OVERMIND_LLM_URL points to an OpenAI-compatible vLLM server.
Invariants: Prompt content is never logged and invalid outputs are rejected.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import httpx
import modal
from fastapi import FastAPI
from pydantic import BaseModel, ValidationError

APP_NAME = "overmind-orchestrator"
DEFAULT_LLM_URL = "https://mercanmeh123--overmind-llm-serve.modal.run"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_URL = os.environ.get("OVERMIND_LLM_URL", DEFAULT_LLM_URL).rstrip("/")
LLM_TIMEOUT_S = int(os.environ.get("OVERMIND_LLM_TIMEOUT_S", "60"))
LOG_TRUNCATE_CHARS = 200

image = modal.Image.debian_slim().pip_install(
    "fastapi",
    "httpx",
)

app = modal.App(APP_NAME)
web_app = FastAPI()


class FilePayload(BaseModel):
    path: str
    content: str


class ExecuteRequest(BaseModel):
    prompt: str
    files: list[FilePayload]
    scope: Optional[list[str]] = None
    promptId: str


class FileChange(BaseModel):
    path: str
    content: str


class LlmResponse(BaseModel):
    summary: str
    files: list[FileChange]


def log(message: str) -> None:
    """
    Write a timestamped log message.
    Does not include prompt content.
    """
    ts = datetime.now(timezone.utc).isoformat()
    truncated = message[:LOG_TRUNCATE_CHARS]
    print(f"[{ts}] {truncated}")


def normalize_files(files: Iterable[FilePayload]) -> list[dict[str, str]]:
    """
    Normalize and sort file payloads for deterministic ordering.
    Does not mutate the input list.
    """
    normalized = [
        {"path": file_payload.path, "content": file_payload.content}
        for file_payload in files
    ]
    return sorted(normalized, key=lambda item: item["path"])


def build_system_prompt() -> str:
    """
    Build the system prompt for deterministic JSON output.
    Does not depend on runtime state.
    """
    return (
        "You are Overmind's execution engine. "
        "Return only JSON with keys: summary, files. "
        "Each file entry must include path and content. "
        "Do not include markdown or explanations."
    )


def build_user_prompt(req: ExecuteRequest) -> str:
    """
    Build the user prompt with the prompt and file pack.
    Does not log or mutate request payloads.
    """
    payload = {
        "prompt": req.prompt,
        "promptId": req.promptId,
        "scope": req.scope or [],
        "files": normalize_files(req.files),
    }
    return json.dumps(payload, ensure_ascii=False)


def strip_code_fences(text: str) -> str:
    """
    Remove surrounding markdown code fences if present.
    Does not alter inner JSON content.
    """
    trimmed = text.strip()
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```[a-zA-Z0-9]*\\n", "", trimmed)
        if trimmed.endswith("```"):
            trimmed = trimmed[: -3]
    return trimmed.strip()


def validate_llm_response(payload: Any) -> LlmResponse:
    """
    Validate the LLM JSON output against the response schema.
    Raises ValidationError on mismatch.
    """
    if hasattr(LlmResponse, "model_validate"):
        return LlmResponse.model_validate(payload)
    return LlmResponse.parse_obj(payload)


async def call_llm(req: ExecuteRequest) -> LlmResponse:
    """
    Call the vLLM OpenAI-compatible server and parse the response.
    Raises on HTTP or schema validation errors.
    """
    headers = {"Content-Type": "application/json"}
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": MODEL_ID,
        "messages": [
            {"role": "system", "content": build_system_prompt()},
            {"role": "user", "content": build_user_prompt(req)},
        ],
        "temperature": 0,
        "top_p": 1,
        "seed": 0,
    }

    url = f"{LLM_URL}/v1/chat/completions"
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT_S) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    choices = data.get("choices")
    if not choices:
        raise ValueError("LLM response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LLM response missing content")

    cleaned = strip_code_fences(content)
    parsed = json.loads(cleaned)
    return validate_llm_response(parsed)


@web_app.get("/health")
async def health() -> dict[str, object]:
    """
    Check LLM connectivity by requesting the model list.
    Does not raise on failure.
    """
    url = f"{LLM_URL}/v1/models"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(url)
            response.raise_for_status()
        return {"status": "ok", "llm_connected": True}
    except Exception as exc:
        log(f"health check failed: {exc}")
        return {"status": "ok", "llm_connected": False}


@web_app.post("/execute")
async def execute(req: ExecuteRequest) -> dict[str, object]:
    """
    Execute a prompt by calling the LLM and returning file changes.
    Returns success=false with error details on failure.
    """
    log(
        "execute promptId="
        f"{req.promptId} prompt_len={len(req.prompt)} "
        f"files={len(req.files)}"
    )
    try:
        result = await call_llm(req)
    except (ValidationError, json.JSONDecodeError, ValueError) as exc:
        log(f"invalid llm response: {exc}")
        return {"success": False, "error": "Invalid LLM response", "files": []}
    except Exception as exc:
        log(f"execution failed: {exc}")
        return {"success": False, "error": "LLM execution failed", "files": []}

    files = [
        {"path": file_change.path, "content": file_change.content}
        for file_change in result.files
    ]
    return {"success": True, "files": files, "summary": result.summary}


@app.function(image=image)
@modal.asgi_app()
def fastapi_app() -> FastAPI:
    """
    Expose the FastAPI application via Modal.
    Does not mutate application state.
    """
    return web_app
