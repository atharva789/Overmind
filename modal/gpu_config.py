"""
GPU backend configuration.

Set OVERMIND_GPU_BACKEND to one of: modal, aws, local.
This file maps logical function names to their remote identifiers
for each backend.
"""

from __future__ import annotations

import os
from enum import Enum


class GpuBackend(Enum):
    MODAL = "modal"
    AWS = "aws"
    LOCAL = "local"


GPU_BACKEND = GpuBackend(os.environ.get("OVERMIND_GPU_BACKEND", "modal"))

# Modal: "<app_name>.<function_or_class_method>"
MODAL_FUNCTIONS: dict[str, str] = {
    "generate_embeddings": "overmind-gpu.generate_embeddings",
    "run_llm": "overmind-llm.LLMServer._generate",
}

# AWS: SageMaker endpoint names
AWS_ENDPOINTS: dict[str, str] = {
    "generate_embeddings": "overmind-embeddings",
    "run_llm": "overmind-llm",
}
