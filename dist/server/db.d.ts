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
export declare function getPool(): pg.Pool;
/** Backwards-compatible export — lazily creates the pool on first access. */
export declare const pool: pg.Pool;
export declare function initDb(): Promise<void>;
