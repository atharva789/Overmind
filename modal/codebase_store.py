"""
Purpose: Provide database persistence helpers for codebase indexing in Overmind.
High-level behavior: Encapsulates asyncpg transactions for upserting branches,
  storing code chunks, and resolving duplicate projects by embedding similarity.
Assumptions: Callers supply a live asyncpg connection pool. Embeddings are
  already computed before these helpers are called.
Invariants: All DB writes are wrapped in transactions. No external I/O beyond
  the provided pool. Raises HTTPException on DB errors so callers need not
  re-wrap them.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from codebase_indexer import average_vectors, cosine_similarity

SIMILARITY_THRESHOLD = 0.97
_LOG_TRUNCATE_CHARS = 1000


def _log(message: str) -> None:
    """
    Write a timestamped log entry to stdout.
    Does not include caller context beyond the message.
    Edge cases: Long messages are truncated to _LOG_TRUNCATE_CHARS.
    Invariants: Always includes a UTC timestamp prefix.
    """
    ts = datetime.now(timezone.utc).isoformat()
    print(f"[{ts}] {message[:_LOG_TRUNCATE_CHARS]}")


async def upsert_branch_only(
    db_pool: Any,
    project_id: str,
    branch_name: str,
) -> str:
    """
    Upsert a branch record and return its branch_id as a string.
    Does not touch code_chunks.
    Edge cases: Raises HTTP 500 on DB error.
    Invariants: Uses ON CONFLICT DO UPDATE so re-runs are idempotent.
    """
    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO branches (name, project_id)
                    VALUES ($1, $2)
                    ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
                    RETURNING branch_id
                    """,
                    branch_name,
                    project_id,
                )
        return str(row["branch_id"])
    except Exception as exc:
        _log(f"upsert_branch_only: DB error: {exc}")
        raise HTTPException(status_code=500, detail="database error")


async def resolve_similar_project(
    db_pool: Any,
    project_id: str,
    new_centroid: list[float],
) -> str:
    """
    Query existing projects and return the ID of the most similar one if its
    cosine similarity to new_centroid exceeds SIMILARITY_THRESHOLD.
    Falls back to project_id if no sufficiently similar project is found.
    Does not mutate any DB rows.
    Edge cases: Raises HTTP 500 on DB query error; logs and skips malformed rows.
    Invariants: Returns a non-empty string project ID.
    """
    try:
        async with db_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT project_id, embedding FROM (
                    SELECT project_id, embedding,
                           ROW_NUMBER() OVER (
                               PARTITION BY project_id ORDER BY created_at DESC
                           ) AS rn
                    FROM code_chunks
                    WHERE project_id != $1
                ) sub WHERE rn <= 10
                LIMIT 1000
                """,
                project_id,
            )
    except Exception as exc:
        _log(f"resolve_similar_project: DB query error: {exc}")
        raise HTTPException(status_code=500, detail="database error")

    if not rows:
        return project_id

    project_embeddings: dict[str, list[list[float]]] = {}
    for row in rows:
        pid = row["project_id"]
        raw_emb = row["embedding"]
        if isinstance(raw_emb, str):
            parsed_emb = [float(x) for x in raw_emb.strip("[]").split(",")]
        else:
            parsed_emb = list(raw_emb)
        project_embeddings.setdefault(pid, []).append(parsed_emb)

    best_sim = 0.0
    best_pid = None
    for pid, vecs in project_embeddings.items():
        try:
            centroid = average_vectors(vecs)
            sim = cosine_similarity(new_centroid, centroid)
            if sim > best_sim:
                best_sim = sim
                best_pid = pid
        except Exception as exc:
            _log(f"resolve_similar_project: centroid error for pid={pid}: {exc}")
            continue

    if best_pid is not None and best_sim > SIMILARITY_THRESHOLD:
        _log(
            f"resolve_similar_project: resolving projectId={project_id} "
            f"→ existing={best_pid} similarity={best_sim:.4f}"
        )
        return best_pid

    return project_id


async def upsert_branch_and_chunks(
    db_pool: Any,
    project_id: str,
    branch_name: str,
    all_chunks: list[dict],
    embeddings: list[list[float]],
    file_hashes: dict[str, str],
) -> tuple[str, int]:
    """
    Upsert a branch and insert all code chunks in a single transaction.
    Returns (branch_id_str, chunks_stored_count).
    Does not re-compute embeddings; callers must supply pre-computed lists.
    Edge cases: Raises HTTP 500 on DB error. ON CONFLICT DO NOTHING skips dupes.
    Invariants: branch_id and all chunks share the same transaction.
    """
    chunks_stored_count = 0
    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    INSERT INTO branches (name, project_id)
                    VALUES ($1, $2)
                    ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
                    RETURNING branch_id
                    """,
                    branch_name,
                    project_id,
                )
                branch_id = row["branch_id"]

                for chunk, embedding in zip(all_chunks, embeddings):
                    emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                    file_hash = file_hashes[chunk["path"]]
                    result = await conn.execute(
                        """
                        INSERT INTO code_chunks
                            (project_id, branch_id, file_path, file_hash,
                             chunk_text, chunk_name, start_line, end_line,
                             embedding)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
                        ON CONFLICT DO NOTHING
                        """,
                        project_id,
                        branch_id,
                        chunk["path"],
                        file_hash,
                        chunk["chunk_text"],
                        chunk["chunk_name"],
                        chunk["start_line"],
                        chunk["end_line"],
                        emb_str,
                    )
                    if result and result.startswith("INSERT"):
                        parts = result.split()
                        if len(parts) >= 3:
                            chunks_stored_count += int(parts[2])
    except HTTPException:
        raise
    except Exception as exc:
        _log(f"upsert_branch_and_chunks: DB upsert error: {exc}")
        raise HTTPException(status_code=500, detail="database error")

    return str(branch_id), chunks_stored_count
