/**
 * Purpose: Git operations for detecting and committing conflict resolutions.
 * High-level behavior: Detects conflict markers in working tree, parses
 *   conflict blocks, writes resolved content, creates branches and commits.
 * Assumptions: simple-git is installed and the projectRoot is a git repo.
 * Invariants: Never commits to main or current working branch.
 *   Resolved content must have zero conflict markers before writing.
 */

import fsSync from "node:fs";
import simpleGit from "simple-git";
import * as fs from "fs/promises";
import * as path from "path";
import type { ConflictingFile, ConflictBlock } from "./types.js";
import { MERGE_BRANCH_PREFIX } from "../../shared/constants.js";

const LOG_FILE = "orchestrator.log";
const CONFLICT_MARKERS = ["<<<<<<<", "=======", ">>>>>>>"];

// ─── Logging ───

function mergeLog(msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [MERGE] ${msg}\n`;
    try {
        fsSync.appendFileSync(LOG_FILE, line);
    } catch {
        // Logging must not crash execution
    }
}

// ─── Public API ───

/**
 * Scans the working directory for files with git conflict markers.
 * Returns structured ConflictingFile objects ready for the resolver.
 * Never throws — returns empty array if git operations fail.
 */
export async function detectConflicts(
    projectRoot: string
): Promise<ConflictingFile[]> {
    try {
        const git = simpleGit({ baseDir: projectRoot });
        const status = await git.status();
        const conflicted = status.conflicted;

        if (conflicted.length === 0) return [];

        const results: ConflictingFile[] = [];

        for (const relPath of conflicted) {
            const absPath = path.resolve(projectRoot, relPath);
            const rawContent = await fs.readFile(absPath, "utf-8");
            const conflicts = parseConflictBlocks(rawContent);

            if (conflicts.length > 0) {
                results.push({ path: relPath, rawContent, conflicts });
            }
        }

        return results;
    } catch {
        return [];
    }
}

/**
 * Parses raw file content and extracts all conflict blocks.
 * A file may have multiple conflict blocks — finds all of them.
 * Returns structured ConflictBlock[] with ours/theirs/line numbers.
 */
export function parseConflictBlocks(
    rawContent: string
): ConflictBlock[] {
    const lines = rawContent.split("\n");
    const blocks: ConflictBlock[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (!line.startsWith("<<<<<<<")) {
            i++;
            continue;
        }

        const startLine = i + 1;
        const oursLines: string[] = [];
        i++;

        // Collect "ours" until =======
        while (i < lines.length && !lines[i].startsWith("=======")) {
            oursLines.push(lines[i]);
            i++;
        }

        if (i >= lines.length) break;
        i++; // skip =======

        const theirsLines: string[] = [];

        // Collect "theirs" until >>>>>>>
        while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
            theirsLines.push(lines[i]);
            i++;
        }

        const endLine = i + 1;

        blocks.push({
            ours: oursLines.join("\n"),
            theirs: theirsLines.join("\n"),
            startLine,
            endLine,
        });

        i++; // skip >>>>>>>
    }

    return blocks;
}

/**
 * Writes resolved file content back to disk, replacing the
 * conflict-marker version entirely with the clean resolved version.
 * Validates that no conflict markers remain before writing.
 * Throws if conflict markers are still present in resolvedContent.
 */
export async function applyResolution(
    projectRoot: string,
    filePath: string,
    resolvedContent: string
): Promise<void> {
    for (const marker of CONFLICT_MARKERS) {
        if (resolvedContent.includes(marker)) {
            throw new Error(
                `Resolved content for ${filePath} still has ` +
                `conflict marker: ${marker} — refusing to write`
            );
        }
    }

    const absPath = path.resolve(projectRoot, filePath);
    await fs.writeFile(absPath, resolvedContent, "utf-8");
    mergeLog(`Applied resolution to: ${filePath}`);
}

/**
 * Creates a new git branch for the resolved changes.
 * Branch name format: overmind/merge-resolved-{partyCode}-{timestamp}
 * Commits all resolved files with a structured commit message.
 * Returns the branch name created.
 */
export async function commitResolutions(
    projectRoot: string,
    partyCode: string,
    resolvedPaths: string[]
): Promise<string> {
    const git = simpleGit({ baseDir: projectRoot });
    const timestamp = Date.now();
    const branchName =
        `${MERGE_BRANCH_PREFIX}-${partyCode}-${timestamp}`;

    mergeLog(`Creating branch: ${branchName}`);
    await git.checkoutLocalBranch(branchName);
    await git.add(resolvedPaths);

    const n = resolvedPaths.length;
    const commitMsg = [
        `overmind: resolve merge conflicts [${partyCode}]`,
        "",
        `Resolved ${n} conflicting files automatically.`,
        "Generated by Overmind Merge Conflict Solver Agent.",
    ].join("\n");

    await git.commit(commitMsg);
    mergeLog(`Committed resolutions on branch: ${branchName}`);

    return branchName;
}
