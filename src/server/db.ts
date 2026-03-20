/**
 * db.ts — Database connection and schema initialization for Overmind.
 *
 * Purpose:
 *   Manages the PostgreSQL connection pool and initializes the Supabase schema
 *   required by the Overmind server. This module is the single source of truth
 *   for all DDL (table creation, column additions, index creation).
 *
 * High-level behavior:
 *   - Exposes a lazily-initialized connection pool via `getPool()` and the
 *     backwards-compatible `pool` proxy.
 *   - `initDb()` runs idempotent DDL statements (CREATE TABLE IF NOT EXISTS,
 *     ALTER TABLE … ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS) so
 *     it is safe to call on every server startup against an already-populated
 *     database.
 *   - Tables are created in dependency order: `branches` before `code_chunks`
 *     so that the foreign-key constraint on `code_chunks.branch_id` can
 *     reference `branches.branch_id` at creation time.
 *
 * Assumptions:
 *   - `OVERMIND_DATABASE_URL` is set in the environment and points to a
 *     Supabase (PostgreSQL-compatible) instance.
 *   - The database user has CREATE TABLE, ALTER TABLE, and CREATE INDEX
 *     privileges.
 *   - `gen_random_uuid()` is available (standard in PostgreSQL ≥ 13 /
 *     Supabase).
 *
 * Invariants:
 *   - At most one `pg.Pool` instance is created per process lifetime.
 *   - All DDL statements are idempotent — re-running `initDb()` must not
 *     alter data or raise errors on an already-initialized schema.
 *   - `code_chunks.branch_id` is nullable so that rows pre-dating branch
 *     support are not broken by the schema migration.
 */

import pg from "pg";

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
    if (!_pool) {
        const url = process.env.OVERMIND_DATABASE_URL ?? "";
        if (!url) {
            console.warn("[db] OVERMIND_DATABASE_URL is not set; DB operations will fail.");
        }
        _pool = new pg.Pool({
            connectionString: url,
            ssl: { rejectUnauthorized: false },
        });
    }
    return _pool;
}

/** Backwards-compatible export — lazily creates the pool on first access. */
export const pool: pg.Pool = new Proxy({} as pg.Pool, {
    get(_target, prop, receiver) {
        return Reflect.get(getPool(), prop, receiver);
    },
});

export async function initDb() {
    const db = getPool();
    try {
        await db.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        await db.query(`
            CREATE TABLE IF NOT EXISTS features (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                project_id TEXT
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS queries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                content TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                feature_id UUID REFERENCES features(id) ON DELETE SET NULL,
                project_id TEXT
            );
        `);

        // branches must be created before code_chunks so the FK reference
        // in code_chunks.branch_id is resolvable at column-addition time.
        await db.query(`
            CREATE TABLE IF NOT EXISTS branches (
                branch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                project_id TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (project_id, name)
            );
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS code_chunks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                project_id TEXT NOT NULL,
                branch_id UUID REFERENCES branches(branch_id) ON DELETE CASCADE,
                file_path TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                chunk_text TEXT NOT NULL,
                chunk_name TEXT,
                start_line INT,
                end_line INT,
                embedding VECTOR(${process.env.OVERMIND_EMBEDDING_DIMS}),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS code_chunks_branch_id_idx
                ON code_chunks (branch_id);
        `);

        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS code_chunks_unique_chunk_idx
                ON code_chunks (project_id, file_path, start_line);
        `);

        console.log(`[db] ${new Date().toISOString()} Supabase schema initialized successfully.`);
    } catch (err) {
        console.log(`[db] ${new Date().toISOString()} Supabase URL: ${process.env.OVERMIND_DATABASE_URL}`);
        console.log(`[db] ${new Date().toISOString()} AWS backedn URL: ${process.env.OVERMIND_ORCHESTRATOR_URL}`)
        console.error(`[db] ${new Date().toISOString()} Failed to initialize schema:`, err);
        throw err;
    }
}
