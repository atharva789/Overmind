import pg from "pg";
const DATABASE_URL = process.env.OVERMIND_DATABASE_URL ??
    "postgresql://postgres.dexwwtjcldhsrxsestyt:Bitqaf-jeqhyp-8xajnu@aws-1-us-east-2.pooler.supabase.com:5432/postgres";
export const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
export async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS features (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                project_id TEXT
            );
        `);
        await pool.query(`
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
    }
    catch (err) {
        console.error("[db] Failed to initialize schema:", err);
        throw err;
    }
}
//# sourceMappingURL=db.js.map