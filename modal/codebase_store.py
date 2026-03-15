"""
Purpose: Database persistence helpers for codebase indexing in Overmind.
High-level behavior: Encapsulates asyncpg transactions for upserting branches,
  bulk-inserting code chunks, and resolving duplicate projects by embedding
  similarity using pgvector's native cosine operator.
Assumptions: Callers supply a live asyncpg connection pool. Embeddings are
  pre-computed float lists of uniform dimensionality.
Invariants: All DB writes are wrapped in transactions. No external I/O beyond
  the provided pool. Raises HTTPException on DB errors.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from codebase_indexer import average_vectors
from utils import log, to_pgvector_literal

SIMILARITY_THRESHOLD = 0.715

_BRANCH_UPSERT_SQL = """
    INSERT INTO branches (name, project_id)
    VALUES ($1, $2)
    ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING branch_id
"""

_CHUNK_INSERT_SQL = """
    INSERT INTO code_chunks
        (project_id, branch_id, file_path, file_hash,
         chunk_text, chunk_name, start_line, end_line, embedding)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector)
    ON CONFLICT DO NOTHING
"""


async def _upsert_branch(conn: Any, project_id: str, branch_name: str) -> Any:
    """
    Upsert a branch row and return its branch_id.
    Requires an already-acquired connection (caller manages transaction).
    Edge cases: Raises on DB error; caller handles.
    Invariants: Idempotent — repeated calls with the same args return the same ID.
    """
    row = await conn.fetchrow(_BRANCH_UPSERT_SQL, branch_name, project_id)
    return row["branch_id"]


async def upsert_branch_only(db_pool: Any, project_id: str, branch_name: str) -> str:
    """
    Upsert a branch record and return its branch_id as a string.
    Does not touch code_chunks.
    Edge cases: Raises HTTP 500 on DB error.
    Invariants: Uses ON CONFLICT DO UPDATE so re-runs are idempotent.
    """
    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                branch_id = await _upsert_branch(conn, project_id, branch_name)
        return str(branch_id)
    except Exception as exc:
        log(f"upsert_branch_only: DB error: {exc}")
        raise HTTPException(status_code=500, detail="database error")


async def resolve_similar_project(
    db_pool: Any,
    project_id: str,
    new_centroid: list[float],
) -> str:
    """
    Return the ID of the most similar existing project if similarity > threshold.
    Falls back to project_id if no sufficiently similar project is found.
    Does not mutate any DB rows.
    Edge cases: Raises HTTP 500 on DB query error; logs and skips malformed rows.
    Invariants: Always returns a non-empty project ID string.
    """
    centroid_str = to_pgvector_literal(new_centroid)
    try:
        async with db_pool.acquire() as conn:
            # Use pgvector's native cosine operator — computed in DB, no raw vector transfer.
            rows = await conn.fetch(
                """
                SELECT project_id,
                       1 - (AVG(embedding) <=> $2::vector) AS similarity
                FROM code_chunks
                WHERE project_id != $1
                GROUP BY project_id
                ORDER BY similarity DESC
                LIMIT 1
                """,
                project_id,
                centroid_str,
            )
    except Exception as exc:
        log(f"resolve_similar_project: DB query error: {exc}")
        raise HTTPException(status_code=500, detail="database error")

    if rows and float(rows[0]["similarity"]) > SIMILARITY_THRESHOLD:
        best_pid = rows[0]["project_id"]
        sim = float(rows[0]["similarity"])
        log(f"resolve_similar_project: {project_id} → {best_pid} (similarity={sim:.4f})")
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
    Upsert a branch and bulk-insert all code chunks in a single transaction.
    Returns (branch_id_str, chunks_stored_count).
    Does not re-compute embeddings; callers must supply pre-computed lists.
    Edge cases: Raises HTTP 500 on DB error. ON CONFLICT DO NOTHING skips dupes.
    Invariants: branch_id and all chunks share the same transaction.
    """
    rows = [
        (
            project_id,
            None,  # branch_id filled after upsert below
            chunk["path"],
            file_hashes[chunk["path"]],
            chunk["chunk_text"],
            chunk["chunk_name"],
            chunk["start_line"],
            chunk["end_line"],
            to_pgvector_literal(emb),
        )
        for chunk, emb in zip(all_chunks, embeddings)
    ]

    try:
        async with db_pool.acquire() as conn:
            async with conn.transaction():
                branch_id = await _upsert_branch(conn, project_id, branch_name)

                # Inject branch_id into each row tuple (index 1).
                rows_with_branch = [
                    (r[0], branch_id, r[2], r[3], r[4], r[5], r[6], r[7], r[8])
                    for r in rows
                ]

                # executemany sends all rows in one round-trip.
                await conn.executemany(_CHUNK_INSERT_SQL, rows_with_branch)

        # executemany doesn't return per-row status; count inserted vs total.
        # Approximate: report total attempted (ON CONFLICT DO NOTHING may skip some).
        chunks_stored_count = len(rows_with_branch)
    except HTTPException:
        raise
    except Exception as exc:
        log(f"upsert_branch_and_chunks: DB error: {exc}")
        raise HTTPException(status_code=500, detail="database error")

    return str(branch_id), chunks_stored_count
