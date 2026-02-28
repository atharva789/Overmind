"""
Purpose: Serve a vLLM OpenAI-compatible API on Modal.
High-level behavior: Launches the vLLM OpenAI server with a fixed model.
Assumptions: Modal secret overmind-llm-auth provides OVERMIND_LLM_API_KEY.
Invariants: The server binds to a fixed port and exposes OpenAI endpoints.
"""

from __future__ import annotations

import os
import subprocess

import modal

APP_NAME = "overmind-llm"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
PORT = 8000
LLM_SECRET_NAME = "overmind-llm-auth"

image = modal.Image.debian_slim().pip_install(
    "vllm",
)

app = modal.App(APP_NAME)


def build_command(api_key: str | None) -> list[str]:
    """
    Build a deterministic vLLM OpenAI API command.
    Does not mutate global state.
    """
    command = [
        "python",
        "-m",
        "vllm.entrypoints.openai.api_server",
        "--model",
        MODEL_ID,
        "--host",
        "0.0.0.0",
        "--port",
        str(PORT),
    ]
    if api_key:
        command.extend(["--api-key", api_key])
    return command


@app.function(
    gpu=modal.gpu.H100(),
    image=image,
    secrets=[modal.Secret.from_name(LLM_SECRET_NAME)],
)
@modal.web_server(port=PORT)
def serve() -> None:
    """
    Run the vLLM OpenAI-compatible server process.
    Does not return unless the subprocess exits.
    """
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    command = build_command(api_key)
    subprocess.run(command, check=True)
