/**
 * Purpose: Persist and load project metadata on the host machine.
 * High-level behavior: Reads/writes ~/.overmind/projects/<projectId>.json.
 * Assumptions: Only called by the host process, not by clients.
 * Invariants: If the file exists, the stored projectId always matches the filename.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ProjectRecord {
    projectId: string;
    branchName: string;
    createdAt: string;
}

const OVERMIND_PROJECTS_DIR = path.join(os.homedir(), ".overmind", "projects");

/**
 * Load an existing project record or create a new one.
 * Does not overwrite an existing record — returns the persisted data as-is.
 */
export function loadOrCreateProjectRecord(
    projectId: string,
    branchName: string = "main"
): ProjectRecord {
    fs.mkdirSync(OVERMIND_PROJECTS_DIR, { recursive: true });
    const filePath = path.join(OVERMIND_PROJECTS_DIR, `${projectId}.json`);

    if (fs.existsSync(filePath)) {
        try {
            const raw = fs.readFileSync(filePath, "utf-8");
            return JSON.parse(raw) as ProjectRecord;
        } catch (err) {
            console.warn(`[project-store] ${new Date().toISOString()} Corrupted record at ${filePath}; recreating.`, err);
            // Fall through to create a fresh record below
        }
    }

    const record: ProjectRecord = {
        projectId,
        branchName,
        createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
    return record;
}
