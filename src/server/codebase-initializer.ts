/**
 * Purpose: Send host project files to Modal for chunking and embedding.
 * High-level behavior: Walks workspace files and POSTs to /initialize_codebase.
 * Assumptions: Only called when OVERMIND_ORCHESTRATOR_URL is set.
 * Invariants: Never throws — logs and returns null on any failure.
 */

import fs from "node:fs";
import path from "node:path";
import { get_OVERMIND_ORCHESTRATOR_URL } from "../shared/constants.js";

export interface InitializeCodebaseResult {
    resolvedProjectId: string;
    branchId: string;
    chunksStored: number;
}

const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    ".overmind",
    "modal-bridge",
]);

const MAX_WALK_DEPTH = 4;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file

/**
 * Walk a directory recursively up to a depth limit.
 * Does not follow symlinks or traverse excluded directories.
 */
function walkWorkspace(
    root: string,
    relative: string,
    depth: number,
    result: Record<string, string>
): void {
    if (depth > MAX_WALK_DEPTH) return;
    const absolute = path.join(root, relative);
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) continue;
            walkWorkspace(root, path.join(relative, entry.name), depth + 1, result);
        } else if (entry.isFile()) {
            const relPath = path.join(relative, entry.name).replace(/\\/g, "/");
            const absPath = path.join(root, relPath);
            try {
                const stat = fs.statSync(absPath);
                if (stat.size > MAX_FILE_BYTES) continue;
                const content = fs.readFileSync(absPath, "utf-8");
                result[relPath] = content;
            } catch {
                // Skip unreadable or binary files
            }
        }
    }
}

/**
 * Pack all workspace files into a path→content map.
 * Does not include excluded directories or files exceeding the size limit.
 */
function packWorkspaceFiles(projectRoot: string): Record<string, string> {
    const files: Record<string, string> = {};
    walkWorkspace(projectRoot, ".", 0, files);
    return files;
}

/**
 * POST project files to Modal's /initialize_codebase endpoint.
 * Returns null (and logs) on any error — never throws.
 */
export async function initializeCodebase(
    projectRoot: string,
    projectId: string,
    branchName: string,
): Promise<InitializeCodebaseResult | null> {
    const orchestratorUrl = get_OVERMIND_ORCHESTRATOR_URL();
    if (!orchestratorUrl) return null;

    let files: Record<string, string>;
    try {
        files = packWorkspaceFiles(projectRoot);
    } catch (err) {
        console.error(
            `[codebase-init] ${new Date().toISOString()} Failed to pack workspace:`,
            err
        );
        return null;
    }

    try {
        const res = await fetch(`${orchestratorUrl}/initialize_codebase`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, branchName, files }),
        });
        if (!res.ok) {
            console.error(
                `[codebase-init] ${new Date().toISOString()} HTTP ${res.status}: ${await res.text()}`
            );
            return null;
        }
        return (await res.json()) as InitializeCodebaseResult;
    } catch (err) {
        console.error(
            `[codebase-init] ${new Date().toISOString()} Request failed:`,
            err
        );
        return null;
    }
}
