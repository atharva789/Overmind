"""
@gpu_process decorator — routes function execution to the configured GPU backend.

Usage:
    from gpu_process import gpu_process

    @gpu_process(gpu="A100", timeout=300)
    async def generate_embeddings(texts: list[str]) -> list[list[float]]:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer("all-MiniLM-L6-v2")
        return model.encode(texts).tolist()

    # Call it like a normal async function — the decorator handles routing.
    result = await generate_embeddings(["hello world"])

The decorator checks OVERMIND_GPU_BACKEND (via gpu_config) to decide where to run:
    - "modal"  → calls a pre-registered Modal Function by name
    - "aws"    → invokes a SageMaker endpoint
    - "local"  → runs the function directly on the local machine
"""

from __future__ import annotations

import functools
import json
import logging
from typing import Any

from gpu_config import GPU_BACKEND, GpuBackend, MODAL_FUNCTIONS, AWS_ENDPOINTS

logger = logging.getLogger("gpu_process")


def gpu_process(gpu: str = "any", timeout: int = 300):
    """
    Decorator that routes an async function to the configured GPU backend.

    Args:
        gpu: Requested GPU type hint (e.g. "A100", "H100", "T4").
             Used by Modal for container selection. Ignored for local/AWS.
        timeout: Maximum execution time in seconds.
    """

    def decorator(func):
        func_name = func.__name__

        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            backend = GPU_BACKEND

            logger.info(
                "gpu_process: routing %s to %s (gpu=%s, timeout=%d)",
                func_name, backend.value, gpu, timeout,
            )

            if backend == GpuBackend.LOCAL:
                return await _run_local(func, args, kwargs)
            elif backend == GpuBackend.MODAL:
                return await _run_modal(func_name, args, kwargs, timeout)
            elif backend == GpuBackend.AWS:
                return await _run_aws(func_name, args, kwargs, timeout)
            else:
                raise ValueError(f"Unknown GPU backend: {backend}")

        # Expose metadata for introspection
        wrapper._gpu_config = {"gpu": gpu, "timeout": timeout, "name": func_name}
        return wrapper

    return decorator


# ---------------------------------------------------------------------------
# Backend implementations
# ---------------------------------------------------------------------------

async def _run_local(func, args: tuple, kwargs: dict) -> Any:
    """Run the function directly on the local machine."""
    return await func(*args, **kwargs)


async def _run_modal(func_name: str, args: tuple, kwargs: dict, timeout: int) -> Any:
    """Look up a pre-registered Modal Function and call it remotely."""
    import modal

    lookup_key = MODAL_FUNCTIONS.get(func_name)
    if not lookup_key:
        raise ValueError(
            f"No Modal function registered for '{func_name}'. "
            f"Add it to MODAL_FUNCTIONS in gpu_config.py. "
            f"Available: {list(MODAL_FUNCTIONS.keys())}"
        )

    # lookup_key format: "app-name.ClassName.method" or "app-name.function_name"
    parts = lookup_key.split(".", 1)
    if len(parts) != 2:
        raise ValueError(
            f"Invalid Modal lookup key '{lookup_key}'. "
            f"Expected format: 'app-name.function_name'"
        )

    app_name, function_path = parts

    # modal.Function.lookup resolves both plain functions and cls methods
    remote_fn = modal.Function.lookup(app_name, function_path)
    return await remote_fn.remote.aio(*args, **kwargs)


async def _run_aws(func_name: str, args: tuple, kwargs: dict, timeout: int) -> Any:
    """Invoke an AWS SageMaker endpoint."""
    import boto3

    endpoint_name = AWS_ENDPOINTS.get(func_name)
    if not endpoint_name:
        raise ValueError(
            f"No AWS endpoint registered for '{func_name}'. "
            f"Add it to AWS_ENDPOINTS in gpu_config.py. "
            f"Available: {list(AWS_ENDPOINTS.keys())}"
        )

    client = boto3.client("sagemaker-runtime")

    # Serialize args/kwargs into JSON payload
    payload = json.dumps({
        "args": [_serialize(a) for a in args],
        "kwargs": {k: _serialize(v) for k, v in kwargs.items()},
    })

    response = client.invoke_endpoint(
        EndpointName=endpoint_name,
        ContentType="application/json",
        Body=payload,
        CustomAttributes=json.dumps({"timeout": timeout}),
    )

    body = response["Body"].read().decode("utf-8")
    return json.loads(body)


def _serialize(obj: Any) -> Any:
    """Best-effort JSON-safe serialization for function arguments."""
    if isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    if isinstance(obj, (list, tuple)):
        return [_serialize(item) for item in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    # Fall back to string representation
    return str(obj)
