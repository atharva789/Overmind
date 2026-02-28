import pg from "pg";

const { Pool } = pg;

// We use the OVERMIND_DATABASE_URL or OVERMIND_SUPABASE_DB environment variable if provided,
// otherwise default to a local standard postgres url.
const connectionString = process.env.OVERMIND_DATABASE_URL || process.env.OVERMIND_SUPABASE_DB || "postgresql://postgres:postgres@localhost:5432/overmind";

export const dbOptions = {
    connectionString,
};

export const pool = new Pool(dbOptions);

export async function initDb() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS projects (
                id VARCHAR PRIMARY KEY,
                initialized BOOLEAN DEFAULT FALSE
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS features (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS queries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                content TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                feature_id UUID REFERENCES features(id) ON DELETE SET NULL,
                project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE
            );
        `);

        console.log("[db] PostgreSQL schema initialized successfully.");
    } catch (err) {
        console.error("[db] Failed to initialize schema:", err);
        throw err;
    } finally {
        client.release();
    }
}
