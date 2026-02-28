"""
Purpose: Serve a vLLM API on Modal with a warm GPU container.
High-level behavior: Loads the vLLM engine in a GPU-backed class
and serves FastAPI.
Assumptions: Modal secret overmind-llm-auth provides OVERMIND_LLM_API_KEY.
Invariants: Exposes /v1/chat/completions and /v1/models endpoints
for the orchestrator.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

import modal
from fastapi import FastAPI, HTTPException, Request

APP_NAME = "overmind-llm"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_SECRET_NAME = "overmind-llm-auth"

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "vllm==0.16.0",
)

app = modal.App(APP_NAME)
web_app = FastAPI()


def log_event(message: str) -> None:
    """
    Write a timestamped log line for server events.
    Does not log prompt content.
    Edge cases: None.
    Invariants: Always includes UTC ISO timestamps.
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    print(f"[{timestamp}] llm_server {message}")


def check_auth(request: Request) -> None:
    """
    Validate the incoming request against the expected API key.
    """
    api_key = os.environ.get("OVERMIND_LLM_API_KEY")
    if not api_key:
        return
    auth_header = request.headers.get("Authorization")
    if auth_header != f"Bearer {api_key}":
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.cls(
    gpu="H100",
    image=image,
    secrets=[modal.Secret.from_name(LLM_SECRET_NAME)],
    timeout=3600,
    min_containers=1,
    max_containers=1,
)
class LLMServer:
    @modal.enter()
    def load(self):
        """
        Initialize engine state without binding to an event loop.
        Does not create the engine to avoid loop mismatches.
        Edge cases: None.
        Invariants: Engine is initialized lazily per container.
        """
        self.engine = None
        self.engine_generation = 0
        self.engine_lock = None

    async def _build_engine(self):
        """
        Build and warm a new AsyncLLMEngine instance.
        Does not reuse previous engine references.
        Edge cases: Raises on vLLM initialization failures.
        Invariants: Returns a warmed, ready-to-use engine.
        """
        from vllm import SamplingParams
        from vllm.engine.arg_utils import AsyncEngineArgs
        from vllm.engine.async_llm_engine import AsyncLLMEngine
        from vllm.utils import random_uuid

        log_event("initializing vLLM AsyncLLMEngine")
        engine_args = AsyncEngineArgs(
            model=MODEL_ID,
            tensor_parallel_size=1,
            gpu_memory_utilization=0.90,
            enforce_eager=False,
        )
        engine = AsyncLLMEngine.from_engine_args(engine_args)

        log_event("warming up engine")
        prompt = "Warm up prompt"
        request_id = random_uuid()
        params = SamplingParams(max_tokens=1)
        async for _ in engine.generate(prompt, params, request_id):
            pass
        log_event("warmup complete")
        return engine

    async def _ensure_engine(self) -> None:
        """
        Ensure the engine is initialized in the active event loop.
        Does not warm up if the engine is already available.
        Edge cases: Serializes initialization with a lock.
        Invariants: Engine is ready after this call completes.
        """
        if self.engine is not None:
            return
        if self.engine_lock is None:
            self.engine_lock = asyncio.Lock()
        async with self.engine_lock:
            if self.engine is None:
                self.engine = await self._build_engine()
                self.engine_generation += 1

    async def _restart_engine(self, generation: int, reason: str) -> None:
        """
        Restart the engine after detecting a failure.
        Does not restart if a newer engine generation is present.
        Edge cases: Serializes restarts with a lock.
        Invariants: Engine generation increments on rebuild.
        """
        if self.engine_lock is None:
            self.engine_lock = asyncio.Lock()
        async with self.engine_lock:
            if self.engine_generation != generation:
                return
            log_event(f"restarting engine: {reason}")
            self.engine = await self._build_engine()
            self.engine_generation += 1

    async def _generate_once(
        self,
        prompt: str,
        temperature: float,
        top_p: float,
        seed: int,
    ) -> str:
        """
        Generate text for a single request using the active engine.
        Does not handle engine restarts or retries.
        Edge cases: Returns empty string on empty outputs.
        Invariants: Consumes the full vLLM stream.
        """
        from vllm import SamplingParams
        from vllm.utils import random_uuid

        request_id = random_uuid()
        sampling_params = SamplingParams(
            temperature=temperature,
            top_p=top_p,
            seed=seed,
            max_tokens=8192,
        )

        generator = self.engine.generate(prompt, sampling_params, request_id)
        final_output = None
        async for request_output in generator:
            final_output = request_output

        if final_output and final_output.outputs:
            return final_output.outputs[0].text
        return ""

    @modal.method()
    async def _generate(
        self,
        prompt: str,
        temperature: float = 0.0,
        top_p: float = 1.0,
        seed: int = 0
    ) -> str:
        """
        Internal generation method executing on the GPU container.
        Retries once if the engine dies mid-request.
        """
        from vllm.v1.engine.exceptions import EngineDeadError

        await self._ensure_engine()
        for attempt in range(2):
            generation = self.engine_generation
            try:
                return await self._generate_once(
                    prompt,
                    temperature,
                    top_p,
                    seed,
                )
            except EngineDeadError as exc:
                if attempt == 1:
                    raise
                await self._restart_engine(generation, str(exc))
        return ""

    @modal.asgi_app()
    def serve(self):
        """
        Exposes the FastAPI server on port 8000.
        """
        @web_app.on_event("startup")
        async def startup():
            await self._ensure_engine()

        @web_app.get("/v1/models")
        async def models(request: Request):
            check_auth(request)
            return {"data": [{"id": MODEL_ID}]}

        @web_app.post("/v1/chat/completions")
        async def chat_completions(request: Request):
            check_auth(request)
            try:
                body = await request.json()
            except Exception as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid JSON payload: {exc}",
                )

            messages = body.get("messages")
            if not isinstance(messages, list) or not messages:
                raise HTTPException(
                    status_code=400,
                    detail="messages must be a non-empty list",
                )

            await self._ensure_engine()
            tokenizer = self.engine.get_tokenizer()
            prompt = tokenizer.apply_chat_template(
                messages, 
                tokenize=False, 
                add_generation_prompt=True
            )

            try:
                text = await self._generate.local(
                    prompt=prompt,
                    temperature=body.get("temperature", 0.0),
                    top_p=body.get("top_p", 1.0),
                    seed=body.get("seed", 0),
                )
            except Exception as exc:
                log_event(f"generation failed: {exc}")
                raise HTTPException(
                    status_code=503,
                    detail="Generation failed; engine restarting.",
                )

            return {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": text
                        }
                    }
                ]
            }

        return web_app
