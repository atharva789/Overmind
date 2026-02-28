"""
Purpose: Serve a vLLM API on Modal with a warm GPU container.
High-level behavior: Loads the vLLM engine in a GPU-backed class
and serves FastAPI.
Assumptions: Modal secret overmind-llm-auth provides OVERMIND_LLM_API_KEY.
Invariants: Exposes /v1/chat/completions and /v1/models endpoints
for the orchestrator.
"""

from __future__ import annotations

import os
import modal
from fastapi import FastAPI, Request, HTTPException

APP_NAME = "overmind-llm"
MODEL_ID = os.environ.get("MODEL_ID", "openai/gpt-oss-20b")
LLM_SECRET_NAME = "overmind-llm-auth"

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "vllm==0.16.0",
)

app = modal.App(APP_NAME)
web_app = FastAPI()

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
        Load the vLLM engine into GPU memory for warm startups.
        """
        from vllm.engine.arg_utils import AsyncEngineArgs
        from vllm.engine.async_llm_engine import AsyncLLMEngine

        print("Initializing vLLM AsyncLLMEngine...")
        engine_args = AsyncEngineArgs(
            model=MODEL_ID,
            tensor_parallel_size=1,
            gpu_memory_utilization=0.90,
            enforce_eager=False,
        )
        self.engine = AsyncLLMEngine.from_engine_args(engine_args)

        # Warm up the engine to capture CUDA graphs
        import asyncio
        from vllm import SamplingParams
        from vllm.utils import random_uuid
        
        async def warmup():
            print("Warming up engine...")
            prompt = "Warm up prompt"
            req_id = random_uuid()
            params = SamplingParams(max_tokens=1)
            async for _ in self.engine.generate(prompt, params, req_id):
                pass
            print("Warmup complete.")

        asyncio.run(warmup())
        print("Model loaded into VRAM.")

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

    @modal.asgi_app()
    def serve(self):
        """
        Exposes the FastAPI server on port 8000.
        """
        @web_app.get("/v1/models")
        async def models(request: Request):
            check_auth(request)
            return {"data": [{"id": MODEL_ID}]}

        @web_app.post("/v1/chat/completions")
        async def chat_completions(request: Request):
            check_auth(request)
            body = await request.json()
            messages = body.get("messages", [])
            
            tokenizer = await self.engine.get_tokenizer()
            prompt = tokenizer.apply_chat_template(
                messages, 
                tokenize=False, 
                add_generation_prompt=True
            )

            text = await self._generate.local(
                prompt=prompt,
                temperature=body.get("temperature", 0.0),
                top_p=body.get("top_p", 1.0),
                seed=body.get("seed", 0),
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
