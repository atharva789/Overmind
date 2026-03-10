"""
Purpose: Helpers and models for codebase chunking and similarity indexing.
High-level behavior: Splits files into line-range chunks, computes vector
  averages and cosine similarities, and defines the Pydantic request/response
  models used by the initialize_codebase endpoint in orchestrator.py.
Assumptions: Callers supply non-None file contents; embeddings are
  equal-length float lists produced by the same embedding model.
Invariants: chunk_file never returns whitespace-only chunks; average_vectors
  raises ValueError on empty input; cosine_similarity returns 0.0 for
  zero-magnitude vectors rather than dividing by zero.
"""

from __future__ import annotations

import math
from typing import Optional

from pydantic import BaseModel


class InitializeCodebaseRequest(BaseModel):
    projectId: str
    branchName: str = "main"
    files: dict[str, str]  # path → content


class InitializeCodebaseResponse(BaseModel):
    resolvedProjectId: str
    branchId: str
    chunksStored: int


def chunk_file(path: str, content: str, chunk_size: int = 50) -> list[dict]:
    """
    Split a file's content into chunks of `chunk_size` lines.
    Does not include chunks that are purely whitespace.
    Edge cases: empty files produce no chunks; partial trailing groups are included.
    """
    lines = content.split("\n")
    chunks: list[dict] = []
    for i in range(0, len(lines), chunk_size):
        group = lines[i : i + chunk_size]
        chunk_text = "\n".join(group)
        if not chunk_text.strip():
            continue
        start_line = i + 1  # 1-indexed
        end_line = i + len(group)
        chunk_name = f"{path}:{start_line}"
        chunks.append(
            {
                "path": path,
                "chunk_name": chunk_name,
                "chunk_text": chunk_text,
                "start_line": start_line,
                "end_line": end_line,
            }
        )
    return chunks


def average_vectors(vectors: list[list[float]]) -> list[float]:
    """
    Compute element-wise average of a list of float vectors.
    Does not mutate inputs.
    Edge cases: raises ValueError if vectors is empty or vectors have different lengths.
    """
    if not vectors:
        raise ValueError("average_vectors: empty list")
    dim = len(vectors[0])
    total = [0.0] * dim
    for vec in vectors:
        for j, v in enumerate(vec):
            total[j] += v
    n = len(vectors)
    return [x / n for x in total]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Compute cosine similarity between two vectors.
    Does not mutate inputs.
    Edge cases: returns 0.0 if either vector has zero magnitude.
    """
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)
