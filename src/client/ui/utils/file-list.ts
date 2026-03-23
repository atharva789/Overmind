/**
 * file-list.ts
 *
 * Purpose: Lists project files for @ autocomplete suggestions.
 * Behavior: Recursively walks the project directory, excluding
 *   common non-project directories. Results are cached with a
 *   10-second TTL to avoid filesystem thrashing on every keystroke.
 * Assumptions: Called from the client side; uses synchronous fs
 *   reads since the file list is needed immediately for UI.
 * Invariants: Never returns paths inside excluded directories.
 *   Always returns paths relative to the given cwd.
 */

import fs from "node:fs";
import path from "node:path";

const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
    "node_modules",
    ".git",
    "dist",
    ".overmind",
    ".claude",
    "__pycache__",
    ".venv",
    ".worktrees",
]);

const DEFAULT_MAX_DEPTH = 6;
const CACHE_TTL_MS = 10_000;

interface FileListCache {
    readonly files: readonly string[];
    readonly timestamp: number;
    readonly cwd: string;
    readonly maxDepth: number;
}

let cachedResult: FileListCache | null = null;

/**
 * Walk a directory tree and collect relative file paths.
 * Does not follow symlinks. Skips excluded directories.
 * Does not mutate any external state; builds a new array.
 */
function walkDirectory(
    rootDir: string,
    currentDir: string,
    maxDepth: number,
    currentDepth: number
): string[] {
    if (currentDepth > maxDepth) {
        return [];
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
        // Permission denied or directory disappeared — skip silently.
        return [];
    }

    const results: string[] = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) {
                continue;
            }
            const subResults = walkDirectory(
                rootDir,
                path.join(currentDir, entry.name),
                maxDepth,
                currentDepth + 1
            );
            results.push(...subResults);
        } else if (entry.isFile()) {
            const relativePath = path.relative(
                rootDir,
                path.join(currentDir, entry.name)
            );
            results.push(relativePath);
        }
    }

    return results;
}

/**
 * List all project files relative to `cwd`, excluding common
 * non-project directories. Results are cached for 10 seconds.
 *
 * Does not modify any shared state beyond the module-level cache.
 * Returns a new array on each call (safe to mutate by caller).
 */
export function listProjectFiles(
    cwd: string,
    maxDepth: number = DEFAULT_MAX_DEPTH
): string[] {
    const now = Date.now();

    if (
        cachedResult !== null &&
        cachedResult.cwd === cwd &&
        cachedResult.maxDepth === maxDepth &&
        now - cachedResult.timestamp < CACHE_TTL_MS
    ) {
        return cachedResult.files as string[];
    }

    const files = walkDirectory(cwd, cwd, maxDepth, 0);
    files.sort();

    cachedResult = {
        files: Object.freeze([...files]),
        timestamp: now,
        cwd,
        maxDepth,
    };

    return files;
}
