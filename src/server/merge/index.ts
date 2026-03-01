/**
 * Purpose: Orchestrate the full merge conflict resolution pipeline.
 * High-level behavior: Detects conflicts, resolves via Modal inference,
 *   applies resolutions to disk, commits to a new branch, opens a PR.
 *   Emits progress events as an AsyncGenerator for real-time UI updates.
 * Assumptions: Sandboxes are terminated before this runs. All sandbox
 *   outputs have been collected and merged (atomic).
 * Invariants: Never throws — errors are emitted as MergeExecutionEvent.
 *   Prompt content is never included in logs, PR text, or commit messages.
 */

import { appendFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import {
    detectConflicts,
    applyResolution,
    commitResolutions,
} from "./git.js";
import { resolveAllConflicts } from "./resolver.js";
import {
    openPullRequest,
    generatePrTitle,
    generatePrDescription,
} from "./github.js";
import type {
    MergeConflictInput,
    MergeResolutionResult,
    MergeExecutionEvent,
} from "./types.js";

const LOG_PATH = "orchestrator.log";

function log(msg: string): void {
    const line = `[${new Date().toISOString()}] [MERGE] ${msg}\n`;
    process.stdout.write(line);
    try {
        appendFileSync(LOG_PATH, line);
    } catch {
        // Log failures must not crash orchestration.
    }
}

/**
 * Read story.md from the project root, returning empty string on error.
 * Never throws.
 */
async function readStoryMd(projectRoot: string): Promise<string> {
    try {
        return await readFile(
            join(projectRoot, "STORY.md"),
            "utf-8"
        );
    } catch {
        return "";
    }
}

/**
 * Main entry point. Orchestrates the full conflict resolution flow.
 * Yields progress events for the terminal UI.
 * Never throws.
 */
export async function* solveMergeConflicts(
    input: MergeConflictInput,
    projectRoot: string
): AsyncGenerator<MergeExecutionEvent> {
    const { partyCode } = input;
    const storyMd = input.storyMd || await readStoryMd(projectRoot);

    try {
        // Step 1: Detect conflicts
        yield { type: "stage", stage: "Detecting merge conflicts..." };
        log(`Party ${partyCode} — conflict detection started`);

        const conflictingFiles = await detectConflicts(projectRoot);

        if (conflictingFiles.length === 0) {
            log(`Party ${partyCode} — no conflicts found`);
            yield {
                type: "complete",
                result: {
                    resolutions: [],
                    prTitle:
                        `[Overmind] Changes applied — Party ${partyCode}`,
                    prDescription: "No merge conflicts detected.",
                    hasLowConfidence: false,
                    branchName: "",
                    prUrl: undefined,
                },
            };
            return;
        }

        log(
            `Party ${partyCode} — ` +
            `${conflictingFiles.length} conflicting file(s) found`
        );

        // Step 2: Resolve via Modal inference
        yield {
            type: "stage",
            stage:
                `Resolving ${conflictingFiles.length} conflicting file(s)` +
                ` via Modal...`,
        };
        const resolutions = await resolveAllConflicts(
            conflictingFiles,
            storyMd
        );
        const hasLowConfidence = resolutions.some(
            (r) => r.confidence === "low"
        );

        // Step 3: Apply resolutions to disk
        yield { type: "stage", stage: "Applying resolutions..." };
        for (const resolution of resolutions) {
            if (!resolution.resolvedContent) {
                log(
                    `Skipping ${resolution.path}` +
                    ` — empty resolved content (fallback failed)`
                );
                continue;
            }
            await applyResolution(
                projectRoot,
                resolution.path,
                resolution.resolvedContent
            );
        }

        // Step 4: Commit to new branch
        const resolvedPaths = resolutions
            .filter((r) => r.resolvedContent)
            .map((r) => r.path);

        const branchName = await commitResolutions(
            projectRoot,
            partyCode,
            resolvedPaths
        );

        // Step 5: Open GitHub PR
        yield { type: "stage", stage: "Opening pull request..." };
        const prTitle = generatePrTitle(partyCode, hasLowConfidence);
        const prDescription = generatePrDescription(
            partyCode,
            storyMd,
            resolutions,
            branchName
        );

        let prUrl: string | undefined;
        try {
            prUrl = await openPullRequest(
                branchName,
                prTitle,
                prDescription
            );
        } catch (err) {
            const msg = err instanceof Error
                ? err.message : String(err);
            log(`PR creation failed: ${msg}`);
            // Do not fail the whole pipeline — resolutions were applied.
        }

        log(
            `Party ${partyCode} — complete. ` +
            `${resolutions.length} file(s) resolved. ` +
            `Branch: ${branchName}. ` +
            `PR: ${prUrl ?? "failed to open"}`
        );

        const result: MergeResolutionResult = {
            resolutions,
            prTitle,
            prDescription,
            hasLowConfidence,
            branchName,
            prUrl,
        };

        yield { type: "complete", result };

    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Unrecoverable error: ${msg}`);
        yield {
            type: "error",
            message: `Merge conflict solver failed: ${msg}`,
        };
    }
}
