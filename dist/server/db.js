import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
const OVERMIND_DIR = path.join(process.cwd(), ".overmind");
if (!fs.existsSync(OVERMIND_DIR)) {
    fs.mkdirSync(OVERMIND_DIR, { recursive: true });
}
// Default to a local SQLite database for easy testing
const dbPath = process.env.OVERMIND_DATABASE_URL || path.join(OVERMIND_DIR, "story.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
// Shim the pool interface to minimize changes in other files
export const pool = {
    query: async (text, params = []) => {
        // Convert $1, $2 to ? for sqlite
        const sqliteText = text.replace(/\$\d+/g, "?").replace(/RETURNING id/i, "");
        const stmt = db.prepare(sqliteText);
        if (sqliteText.trim().toUpperCase().startsWith("SELECT")) {
            return { rows: stmt.all(...params) };
        }
        else {
            const info = stmt.run(...params);
            // If it was an INSERT that had RETURNING id, simulate it
            if (text.match(/RETURNING id/i)) {
                // Return the last inserted row id, disguised as a string UUID if needed
                // Note: Better-sqlite3 returns numeric IDs for AUTOINCREMENT. We used UUIDs below.
                if (text.includes("features")) {
                    const row = db.prepare("SELECT id FROM features WHERE rowid = ?").get(info.lastInsertRowid);
                    return { rows: [{ id: row?.id }] };
                }
                else if (text.includes("queries")) {
                    const row = db.prepare("SELECT id FROM queries WHERE rowid = ?").get(info.lastInsertRowid);
                    return { rows: [{ id: row?.id }] };
                }
            }
            return { rows: [] };
        }
    },
    connect: async () => ({
        query: pool.query,
        release: () => { },
    }),
};
export async function initDb() {
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS features (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                project_id TEXT
            );
        `);
        db.exec(`
            CREATE TABLE IF NOT EXISTS queries (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                content TEXT NOT NULL,
                username TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                feature_id TEXT REFERENCES features(id) ON DELETE SET NULL,
                project_id TEXT
            );
        `);
        console.log("[db] SQLite schema initialized successfully.");
    }
    catch (err) {
        console.error("[db] Failed to initialize schema:", err);
        throw err;
    }
}
//# sourceMappingURL=db.js.map