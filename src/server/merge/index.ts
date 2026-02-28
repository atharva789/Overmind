/**
 * Purpose: Orchestrate the full merge conflict resolution flow.
 * High-level behavior: Detects conflicts, resolves via Gemini, commits to a
 *   new branch, opens a GitHub PR, and emits progress events throughout.
 * Assumptions: Git repo is in a valid state; GEMINI_API_KEY and GITHUB_TOKEN
 *   must be set in environment for full operation.
 * Invariants: Never throws — all errors are caught and emitted as events.
 *   Never includes user prompt content in logs or PR descriptions.
 */

import fsSync from "node:fs";
import type {
    MergeConflictInput,
    MergeResolutionResult,
} from "./types.js";
import {
    detectConflicts,
    applyResolution,
    commitResolutions,
} from "./git.js";
import { resolveAllConflicts } from "./resolver.js";
import {
    buildResolutionResult,
    openPullRequest,
} from "./github.js";

const LOG_FILE = "orchestrator.log";

// ─── Logging ───

function mergeLog(partyCode: string, msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [MERGE] Party ${partyCode} — ${msg}\n`;
    try {
        fsSync.appendFileSync(LOG_FILE, line);
    } catch {
        // Logging must not crash execution
    }
}

// ─── Event types ───

export type MergeEvent =
    | { type: "stage"; stage: string }
    | { type: "complete"; result: MergeResolutionResult }
    | { type: "error"; message: string };

// ─── Main orchestrator ───

/**
 * Main entry point for the merge conflict solver.
 *
 * Flow:
 * 1. Detect all conflicting files in projectRoot
 * 2. If no conflicts, return immediately (nothing to do)
 * 3. Resolve all conflicts using Gemini (sequential, one file at a time)
 * 4. Apply all resolutions to disk
 * 5. Create a new git branch and commit
 * 6. Generate PR title and description
 * 7. Open GitHub PR
 * 8. Yield complete event with MergeResolutionResult
 *
 * Never throws. On any unrecoverable error emits an error event.
 */
export async function* solveMergeConflicts(
    input: MergeConflictInput,
    projectRoot: string
): AsyncGenerator<MergeEvent> {
    const { storyMd, partyCode } = input;

    try {
        // Step 1: Detect conflicts
        yield { type: "stage", stage: "Detecting merge conflicts..." };
        mergeLog(partyCode, "conflict detection started");

        const conflictingFiles =
            input.conflictingFiles.length > 0
                ? input.conflictingFiles
                : await detectConflicts(projectRoot);

        if (conflictingFiles.length === 0) {
            mergeLog(partyCode, "no conflicts detected — skipping");
            return;
        }

        const fileList = conflictingFiles
            .map((f) => `  ${f.path} (${f.conflicts.length} conflict block(s))`)
            .join("\n");
        mergeLog(
            partyCode,
            `${conflictingFiles.length} conflicting files found:\n${fileList}`
        );

        // Step 2: Resolve via Gemini
        yield {
            type: "stage",
            stage: `Resolving ${conflictingFiles.length} conflicting files...`,
        };

        for (const file of conflictingFiles) {
            mergeLog(partyCode, `Resolving ${file.path} via Gemini...`);
        }

        const resolutions = await resolveAllConflicts(
            conflictingFiles,
            storyMd
        );

        // Step 3: Apply resolutions to disk
        yield { type: "stage", stage: "Applying resolutions..." };

        for (const resolution of resolutions) {
            await applyResolution(
                projectRoot,
                resolution.path,
                resolution.resolvedContent
            );
            const conf = resolution.confidence;
            const mark = conf === "low" ? " ⚠️" : "";
            mergeLog(
                partyCode,
                `${resolution.path} resolved — confidence: ${conf}${mark}`
            );
        }

        mergeLog(partyCode, "All resolutions applied to disk");

        // Step 4: Create git branch and commit
        const resolvedPaths = resolutions.map((r) => r.path);
        const branchName = await commitResolutions(
            projectRoot,
            partyCode,
            resolvedPaths
        );
        mergeLog(partyCode, `Branch created: ${branchName}`);

        // Step 5: Build result and open PR
        yield { type: "stage", stage: "Opening pull request..." };

        const partialResult = buildResolutionResult(
            resolutions,
            partyCode,
            storyMd,
            branchName
        );

        let prUrl: string | undefined;
        try {
            prUrl = await openPullRequest(
                branchName,
                partialResult.prTitle,
                partialResult.prDescription
            );
            mergeLog(partyCode, `PR opened: ${prUrl}`);
        } catch (prErr) {
            const prMsg =
                prErr instanceof Error ? prErr.message : String(prErr);
            mergeLog(
                partyCode,
                `PR creation failed: ${prMsg} — description logged below`
            );
            mergeLog(
                partyCode,
                `PR description (manual fallback):\n` +
                partialResult.prDescription.slice(0, 500)
            );

            yield {
                type: "error",
                message:
                    `Conflicts resolved but PR could not be opened: ${prMsg}`,
            };

            // Still emit complete so caller can show the resolution summary
            yield {
                type: "complete",
                result: {
                    ...partialResult,
                    prUrl: undefined,
                },
            };
            return;
        }

        yield {
            type: "complete",
            result: {
                ...partialResult,
                prUrl,
            },
        };
    } catch (err) {
        const message =
            err instanceof Error ? err.message : String(err);
        mergeLog(partyCode, `Unrecoverable error: ${message}`);

        yield { type: "error", message };
    }
}
