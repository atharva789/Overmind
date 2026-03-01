import pg from "pg";
export declare function getPool(): pg.Pool;
/** Backwards-compatible export — lazily creates the pool on first access. */
export declare const pool: pg.Pool;
export declare function initDb(): Promise<void>;
