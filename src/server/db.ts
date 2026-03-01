import pg from "pg";

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
    if (!_pool) {
        const url = process.env.OVERMIND_DATABASE_URL ?? "";
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
    try {
        await getPool().query(`
            CREATE TABLE IF NOT EXISTS features (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                project_id TEXT
            );
        `);

        await getPool().query(`
            CREATE TABLE IF NOT EXISTS queries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                content TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                feature_id UUID REFERENCES features(id) ON DELETE SET NULL,
                project_id TEXT
            );
        `);

        console.log("[db] Supabase schema initialized successfully.");
    } catch (err) {
        console.error("[db] Failed to initialize schema:", err);
        throw err;
    }
}
