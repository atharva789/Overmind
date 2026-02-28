/**
 * Purpose: Manual test runner for the merge conflict solver agent.
 * High-level behavior: Loads conflicted fixture files (or paths given via
 *   argv), builds ConflictingFile objects, runs solveMergeConflicts, and
 *   prints each event to stdout.
 * Assumptions: Run with `npx tsx scripts/test-merge.ts [file1 file2 ...]`
 * Invariants: Does not write to the repo or open real GitHub PRs unless
 *   GITHUB_TOKEN and GITHUB_REPO are set in environment.
 */

import { readFileSync } from "node:fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { parseConflictBlocks } from "../src/server/merge/git.js";
import { solveMergeConflicts } from "../src/server/merge/index.js";
import type { ConflictingFile } from "../src/server/merge/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Resolve file paths ───

const defaultFixtures = [
    "test/fixtures/conflicted/auth.ts",
    "test/fixtures/conflicted/router.ts",
];

const inputPaths =
    process.argv.slice(2).length > 0
        ? process.argv.slice(2)
        : defaultFixtures;

// ─── Load files ───

const conflictingFiles: ConflictingFile[] = [];

for (const relPath of inputPaths) {
    const absPath = path.resolve(PROJECT_ROOT, relPath);
    let rawContent: string;
    try {
        rawContent = readFileSync(absPath, "utf-8");
    } catch {
        console.error(`ERROR: Could not read file: ${absPath}`);
        process.exit(1);
    }

    const conflicts = parseConflictBlocks(rawContent);

    if (conflicts.length === 0) {
        console.warn(
            `WARN: No conflict markers found in ${relPath} — skipping`
        );
        continue;
    }

    console.log(
        `Loaded: ${relPath} (${conflicts.length} conflict block(s))`
    );
    conflictingFiles.push({ path: relPath, rawContent, conflicts });
}

if (conflictingFiles.length === 0) {
    console.log("No conflicting files to resolve. Exiting.");
    process.exit(0);
}

// ─── Load story.md ───

let storyMd = "";
const storyPath = path.resolve(PROJECT_ROOT, "test/fixtures/story.md");
try {
    storyMd = readFileSync(storyPath, "utf-8");
    console.log("Loaded: test/fixtures/story.md");
} catch {
    console.warn(
        "WARN: test/fixtures/story.md not found — " +
        "Gemini will resolve without project context"
    );
}

// ─── Run solver ───

console.log("\n─── Starting merge conflict solver ───\n");

for await (const event of solveMergeConflicts(
    { conflictingFiles, storyMd, partyCode: "TEST" },
    PROJECT_ROOT
)) {
    switch (event.type) {
        case "stage":
            console.log(`[stage] ${event.stage}`);
            break;

        case "complete": {
            const r = event.result;
            console.log(`\n[complete] ${r.resolutions.length} file(s) resolved`);
            console.log(`  Branch:  ${r.branchName}`);
            console.log(`  PR URL:  ${r.prUrl ?? "(not opened)"}`);
            console.log(`  Low confidence: ${r.hasLowConfidence}`);
            console.log("\n─── Resolutions ───\n");
            for (const res of r.resolutions) {
                console.log(`File: ${res.path}`);
                console.log(
                    `  Confidence: ${res.confidence}`
                );
                console.log(
                    `  Reasoning:  ${res.reasoning}`
                );
                if (res.issuesFound.length > 0) {
                    console.log(
                        `  Issues:     ${res.issuesFound.join(", ")}`
                    );
                }
                console.log("\n─── Resolved content ───");
                console.log(res.resolvedContent);
                console.log("─────────────────────\n");
            }
            break;
        }

        case "error":
            console.error(`[error] ${event.message}`);
            break;
    }
}
