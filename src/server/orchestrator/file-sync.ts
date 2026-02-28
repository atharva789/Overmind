/**
 * file-sync.ts — Packs project files for upload to Modal Sandbox.
 *
 * Purpose:
 *   Reads the minimal set of files needed by the agent from the
 *   local project root and returns them as a path->content map.
 *
 * Strategy:
 *   - Always include: files matching ALWAYS_SYNC_PATTERNS.
 *   - Always include: all files in the affectedFiles list.
 *   - Optionally include: files in relatedContextFiles (from hints).
 *   - Exclude: node_modules, .git, dist, .overmind.
 *
 * Assumptions:
 *   - All paths are relative to projectRoot.
 *   - Files are text (UTF-8). Binary files are skipped.
 *   - This is intentionally NOT the entire repo — only what the
 *     agent needs, keeping sandbox creation fast.
 *
 * Invariants:
 *   - Returns only files that exist and are readable.
 *   - Never includes files from excluded directories.
 */

import { readFile } from "fs/promises";
import { join, relative, resolve } from "path";
import { ALWAYS_SYNC_PATTERNS } from "../../shared/constants.js";

// Directories that should never be synced
const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    ".overmind",
    "modal-bridge",
]);

/**
 * Execution hints from the greenlight evaluation.
 * Drives which additional files to include beyond affectedFiles.
 */
export interface ExecutionHints {
    relatedContextFiles?: string[];
    requiresBuild?: boolean;
    requiresTests?: boolean;
}

/**
 * Pack project files for upload to a Modal Sandbox.
 *
 * Collects the minimal set of files the agent needs:
 * 1. Always-sync files (context.md, package.json, tsconfig.json).
 * 2. All files the agent will modify (affectedFiles).
 * 3. Related context files from evaluation hints.
 *
 * Returns a Record<relativePath, fileContent> ready for the
 * bridge API. Silently skips files that don't exist or can't
 * be read (logs a warning instead of failing).
 */
export async function packFiles(
    affectedFiles: string[],
    hints: ExecutionHints,
    projectRoot: string,
): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const seen = new Set<string>();

    // 1. Always-sync patterns
    for (const pattern of ALWAYS_SYNC_PATTERNS) {
        await safeReadFile(
            pattern,
            projectRoot,
            files,
            seen,
        );
    }

    // 2. Affected files
    for (const filePath of affectedFiles) {
        await safeReadFile(filePath, projectRoot, files, seen);
    }

    // 3. Related context files
    if (hints.relatedContextFiles) {
        for (const filePath of hints.relatedContextFiles) {
            await safeReadFile(
                filePath,
                projectRoot,
                files,
                seen,
            );
        }
    }

    return files;
}

/**
 * Safely read a single file and add it to the files map.
 *
 * Normalizes the path, checks against excluded directories,
 * and silently skips files that can't be read.
 * Does NOT follow symlinks outside projectRoot.
 */
async function safeReadFile(
    filePath: string,
    projectRoot: string,
    files: Record<string, string>,
    seen: Set<string>,
): Promise<void> {
    const normalized = relative(
        projectRoot,
        resolve(projectRoot, filePath),
    );

    // Skip if already processed
    if (seen.has(normalized)) return;
    seen.add(normalized);

    // Check against excluded directories
    const parts = normalized.split("/");
    for (const part of parts) {
        if (EXCLUDED_DIRS.has(part)) return;
    }

    // Check for path traversal outside project root
    if (normalized.startsWith("..")) return;

    try {
        const absolutePath = join(projectRoot, normalized);
        const content = await readFile(absolutePath, "utf-8");
        files[normalized] = content;
    } catch {
        // File doesn't exist or can't be read — skip silently.
        // This is expected for optional files like context.md.
    }
}
