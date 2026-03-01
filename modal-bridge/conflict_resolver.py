# modal-bridge/conflict_resolver.py
#
# Purpose: Deploy an OpenAI-compatible LLM inference server on Modal
# specifically for merge conflict resolution. Uses vLLM as the inference
# engine and Qwen3-4B as the model (fast, fits on a single H100, good
# at code tasks).
#
# Deploy with: python -m modal deploy modal-bridge/conflict_resolver.py
# The deployed URL will look like:
#   https://<workspace>--conflict-resolver-web.modal.run
#
# Assumptions:
# - Modal credentials are configured (modal token set)
# - A single H100 GPU is sufficient for Qwen3-4B at FP8 precision
# - The endpoint is called by the Node.js server via HTTP POST /resolve

import modal
import subprocess

# ---------------------------------------------------------------------------
# Container image — vLLM handles CUDA; add fastapi for ASGI routing.
# ---------------------------------------------------------------------------
vllm_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm==0.9.1",
        "huggingface_hub[hf_transfer]",
        "fastapi[standard]",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

# ---------------------------------------------------------------------------
# App definition
# ---------------------------------------------------------------------------
app = modal.App("conflict-resolver")

# ---------------------------------------------------------------------------
# Volume for caching model weights across cold starts.
# ---------------------------------------------------------------------------
model_volume = modal.Volume.from_name(
    "conflict-resolver-model-cache",
    create_if_missing=True
)

MODEL_DIR = "/models"
MODEL_NAME = "Qwen/Qwen3-4B-Thinking-2507-FP8"

# ---------------------------------------------------------------------------
# Download model weights into the volume.
# Run once: python -m modal run modal-bridge/conflict_resolver.py::download_model
# ---------------------------------------------------------------------------
@app.function(
    image=vllm_image,
    volumes={MODEL_DIR: model_volume},
    timeout=60 * 20,  # 20 minutes for initial download
)
def download_model():
    from huggingface_hub import snapshot_download
    snapshot_download(
        MODEL_NAME,
        local_dir=f"{MODEL_DIR}/{MODEL_NAME}",
        ignore_patterns=["*.pt", "*.bin"],  # prefer safetensors
    )
    model_volume.commit()
    print(f"Model downloaded to {MODEL_DIR}/{MODEL_NAME}")


# ---------------------------------------------------------------------------
# vLLM inference server.
#
# Uses @modal.asgi_app() to expose a FastAPI app with a /resolve route,
# keeping the Node.js caller's URL path (/resolve) stable.
#
# GPU: H100 for FP8 support required by Qwen3 FP8 variant.
# @modal.concurrent: handle up to 4 conflict files in parallel per container.
# scaledown_window: scale to zero after 5 min idle.
# ---------------------------------------------------------------------------
@app.cls(
    image=vllm_image,
    gpu="H100",
    volumes={MODEL_DIR: model_volume},
    scaledown_window=60 * 5,
    timeout=60 * 10,
    secrets=[modal.Secret.from_name("conflict-resolver-secrets")],
)
@modal.concurrent(max_inputs=4)
class ConflictResolver:
    @modal.enter()
    def load_model(self):
        """
        Called once when the container starts.
        Launches vLLM as a subprocess on port 8000.
        Polls until the server is ready before accepting requests.
        """
        import time
        import urllib.request

        model_path = f"{MODEL_DIR}/{MODEL_NAME}"

        self._server_process = subprocess.Popen([
            "python", "-m", "vllm.entrypoints.openai.api_server",
            "--model", model_path,
            "--served-model-name", "conflict-resolver",
            "--host", "0.0.0.0",
            "--port", "8000",
            "--max-model-len", "32768",
            "--gpu-memory-utilization", "0.90",
            "--enable-prefix-caching",
            "--dtype", "auto",  # auto-detects FP8 for Qwen3 FP8 variant
        ])

        for _ in range(120):  # wait up to 2 minutes
            try:
                urllib.request.urlopen("http://localhost:8000/health")
                print("vLLM server ready")
                return
            except Exception:
                time.sleep(1)

        raise RuntimeError("vLLM server failed to start within 2 minutes")

    @modal.asgi_app()
    def web(self):
        """
        Expose a FastAPI ASGI app with a POST /resolve route.
        FastAPI runs sync handlers in a thread pool automatically,
        so _call_vllm can use blocking urllib without issues.
        """
        from fastapi import FastAPI
        from pydantic import BaseModel

        web_app = FastAPI()

        class ResolveRequest(BaseModel):
            conflicting_file_path: str = "unknown"
            conflicting_file_content: str = ""
            story_md: str = ""

        @web_app.post("/resolve")
        def resolve(req: ResolveRequest) -> dict:
            return self._call_vllm(
                req.conflicting_file_path,
                req.conflicting_file_content,
                req.story_md,
            )

        return web_app

    def _call_vllm(
        self,
        file_path: str,
        file_content: str,
        story_md: str,
    ) -> dict:
        """
        Build the prompt, call the local vLLM server, parse the response.
        Runs synchronously — FastAPI wraps it in a thread pool executor.
        """
        import urllib.request
        import json

        prompt = (
            "You are a merge conflict resolver for Overmind, a "
            "multiplayer AI coding tool. Multiple AI agents worked on "
            "the same codebase in parallel and produced git merge "
            "conflicts. Resolve them intelligently.\n\n"
            "## PROJECT STORY (what all agents were collectively building)\n"
            f"{story_md}\n\n"
            f"## CONFLICTING FILE: {file_path}\n"
            f"{file_content}\n\n"
            "## RULES\n"
            "- Never leave <<<<<<, =======, or >>>>>>> markers in your output\n"
            "- If both sides add compatible things, combine them intelligently\n"
            "- If both sides conflict, use story.md to decide which aligns\n"
            "- When in doubt, prefer the approach most consistent with story.md\n\n"
            "## RESPONSE FORMAT (respond with exactly this, nothing else)\n\n"
            "RESOLVED_CODE:\n"
            "[complete clean file content here, zero conflict markers]\n\n"
            "REASONING:\n"
            "[1-3 sentences explaining key decisions and why]\n\n"
            "CONFIDENCE: high|medium|low\n\n"
            "ISSUES:\n"
            "[comma separated list of concerns, or \"none\"]"
        )

        payload = json.dumps({
            "model": "conflict-resolver",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert software engineer specializing "
                        "in resolving git merge conflicts. Always respond "
                        "in the exact format requested. Never include "
                        "markdown code fences in your output."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "max_tokens": 8192,
        }).encode()

        req = urllib.request.Request(
            "http://localhost:8000/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())

        raw_text = result["choices"][0]["message"]["content"]
        return _parse_resolver_response(raw_text, file_path)

    @modal.exit()
    def shutdown(self):
        """Clean up the vLLM subprocess on container exit."""
        if hasattr(self, "_server_process"):
            self._server_process.terminate()


def _parse_resolver_response(raw: str, file_path: str) -> dict:
    """
    Parse the LLM's structured text response into a dict.
    Falls back to safe defaults if parsing fails. Never raises.
    """
    try:
        parts = raw.split("RESOLVED_CODE:")
        if len(parts) < 2:
            raise ValueError("No RESOLVED_CODE section found")

        after_code = parts[1]
        code_and_rest = after_code.split("REASONING:")
        resolved_code = code_and_rest[0].strip()

        rest = code_and_rest[1] if len(code_and_rest) > 1 else ""
        reasoning_and_rest = rest.split("CONFIDENCE:")
        reasoning = reasoning_and_rest[0].strip()

        conf_and_issues = (
            reasoning_and_rest[1].split("ISSUES:")
            if len(reasoning_and_rest) > 1
            else ["low", "parse incomplete"]
        )
        confidence_raw = conf_and_issues[0].strip().lower()
        confidence = (
            confidence_raw
            if confidence_raw in ("high", "medium", "low")
            else "low"
        )

        issues_raw = (
            conf_and_issues[1].strip()
            if len(conf_and_issues) > 1
            else "none"
        )
        issues = (
            []
            if issues_raw.lower() == "none"
            else [i.strip() for i in issues_raw.split(",")]
        )

        if any(m in resolved_code for m in ["<<<<<<<", "=======", ">>>>>>>"]):
            return {
                "resolved_code": resolved_code,
                "reasoning": "Conflict markers remain — manual review required",
                "confidence": "low",
                "issues": ["LLM did not fully resolve all conflict markers"],
            }

        return {
            "resolved_code": resolved_code,
            "reasoning": reasoning,
            "confidence": confidence,
            "issues": issues,
        }

    except Exception as e:
        print(f"[conflict-resolver] Parse failure for {file_path}: {e}")
        return {
            "resolved_code": "",
            "reasoning": f"Response parse failed: {str(e)[:100]}",
            "confidence": "low",
            "issues": ["Parse failure — manual review required"],
        }
