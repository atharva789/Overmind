/**
 * index.ts — Orchestrator class for Modal-backed agent execution.
 *
 * Purpose:
 *   Takes greenlit prompts and spawns isolated coding agents on
 *   Modal Sandboxes. Manages the full lifecycle: file sync, sandbox
 *   creation, agent execution, diff extraction, scope validation,
 *   and local apply.
 *
 * Assumptions:
 *   - The Modal bridge is running at MODAL_BRIDGE_URL before
 *     execute() is called.
 *   - EvaluationResult provides affectedFiles and executionHints.
 *   - projectRoot is the absolute path to the host's codebase.
 *
 * Invariants:
 *   - File locks are always released on completion (success or error).
 *   - Sandboxes are always terminated on completion (success or error).
 *   - execute() yields a terminal event (complete or error) exactly once.
 *   - No prompt content is logged — only lengths and metadata.
 */

import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { customAlphabet } from "nanoid";
import {
    MODAL_BRIDGE_URL,
    AGENT_TIMEOUT_S,
    MAX_CONCURRENT_SANDBOXES,
} from "../../shared/constants.js";
import type { PromptEntry } from "../party.js";
import { ModalClient } from "./modal-client.js";
import { FileLockManager } from "./file-lock.js";
import { packFiles } from "./file-sync.js";
import type { ExecutionHints } from "./file-sync.js";
import type {
    AgentExecution,
    ExecutionEvent,
    SandboxConfig,
} from "./result.js";
import type { FileChange } from "../../shared/protocol.js";

const generateSandboxId = customAlphabet(
    "abcdefghijklmnopqrstuvwxyz0123456789",
    12,
);

// ─── EvaluationResult (subset needed by orchestrator) ───

export interface EvaluationResult {
    affectedFiles: string[];
    executionHints: ExecutionHints;
}

// ─── Orchestrator ───

export class Orchestrator {
    private activeExecutions: Map<string, AgentExecution> =
        new Map();
    private fileLocks: FileLockManager;
    private modalClient: ModalClient;
    private projectRoot: string;

    constructor(
        projectRoot: string,
        modalBridgeUrl: string = MODAL_BRIDGE_URL,
    ) {
        this.projectRoot = projectRoot;
        this.fileLocks = new FileLockManager();
        this.modalClient = new ModalClient(modalBridgeUrl);
    }

    /**
     * Execute a greenlit prompt via Modal Sandbox.
     *
     * Returns an async iterator of progress events for real-time
     * UI updates. The iterator completes with either a "complete"
     * or "error" event.
     *
     * Full lifecycle:
     * 1. Acquire file locks
     * 2. Pack project files
     * 3. Create Modal Sandbox
     * 4. Execute coding agent (stream output)
     * 5. Extract diffs
     * 6. Validate scope
     * 7. Apply changes locally
     * 8. Cleanup (terminate sandbox, release locks)
     */
    async *execute(
        prompt: PromptEntry,
        evaluation: EvaluationResult,
    ): AsyncGenerator<ExecutionEvent> {
        const sandboxId = `overmind-${generateSandboxId()}`;
        const affectedFiles = evaluation.affectedFiles;

        // ─── 1. File locks ───
        yield { type: "stage", stage: "Acquiring file locks..." };

        const lockResult = this.fileLocks.tryAcquire(
            prompt.promptId,
            affectedFiles,
        );
        if (!lockResult.acquired) {
            const conflictPaths = lockResult.conflicts
                .map((c) => c.path)
                .join(", ");
            yield {
                type: "stage",
                stage: "Waiting for file locks...",
                detail: `Blocked by: ${conflictPaths}`,
            };

            // Retry once after a delay
            await sleep(3000);
            const retry = this.fileLocks.tryAcquire(
                prompt.promptId,
                affectedFiles,
            );
            if (!retry.acquired) {
                yield {
                    type: "error",
                    message: `File lock conflict: ${conflictPaths}`,
                    recoverable: true,
                };
                return;
            }
        }

        try {
            // ─── 2. Pack files ───
            yield {
                type: "stage",
                stage: "Syncing project files to sandbox...",
            };
            const filePack = await packFiles(
                affectedFiles,
                evaluation.executionHints,
                this.projectRoot,
            );

            // ─── 3. Create sandbox ───
            yield { type: "stage", stage: "Spawning sandbox..." };

            const config: SandboxConfig = {
                image: evaluation.executionHints.requiresBuild
                    ? "build"
                    : "base",
                files: filePack,
                env: {
                    OVERMIND_PROMPT: prompt.content,
                    OVERMIND_PROMPT_ID: prompt.promptId,
                    OVERMIND_SCOPE: affectedFiles.join(","),
                    ANTHROPIC_API_KEY:
                        process.env["ANTHROPIC_API_KEY"] ?? "",
                    GEMINI_API_KEY:
                        process.env["GEMINI_API_KEY"] ?? "",
                },
                timeoutSeconds: AGENT_TIMEOUT_S,
                tags: {
                    promptId: prompt.promptId,
                    username: prompt.username,
                },
            };

            await this.modalClient.createSandbox(
                sandboxId,
                config,
            );

            // Register active execution
            this.activeExecutions.set(prompt.promptId, {
                promptId: prompt.promptId,
                sandboxId,
                username: prompt.username,
                startedAt: Date.now(),
                status: "running",
            });

            // ─── 4. Execute agent ───
            yield { type: "stage", stage: "Agent is working..." };

            const agentCmd = buildAgentCommand(prompt);
            for await (const event of this.modalClient.execStream(
                sandboxId,
                agentCmd,
            )) {
                if (
                    event.type === "stdout" ||
                    event.type === "stderr"
                ) {
                    yield {
                        type: "agent-output",
                        content: event.data,
                    };
                }
                if (
                    event.type === "exit" &&
                    event.data !== "0"
                ) {
                    yield {
                        type: "error",
                        message: `Agent exited with code ${event.data}`,
                        recoverable: false,
                    };
                    await this.cleanup(
                        sandboxId,
                        prompt.promptId,
                    );
                    return;
                }
            }

            // ─── 5. Extract diffs ───
            yield {
                type: "stage",
                stage: "Extracting changes...",
            };
            const changes = await this.modalClient.getDiff(
                sandboxId,
                filePack,
            );

            // ─── 6. Scope validation ───
            const scopedChanges = changes.filter(
                (c: FileChange) => affectedFiles.includes(c.path),
            );

            yield {
                type: "files-changed",
                files: scopedChanges,
            };

            // ─── 7. Apply changes locally ───
            yield {
                type: "stage",
                stage: "Applying changes to codebase...",
            };
            await this.applyChanges(scopedChanges);

            // ─── 8. Optional: run tests ───
            if (evaluation.executionHints.requiresTests) {
                yield {
                    type: "stage",
                    stage: "Running tests in sandbox...",
                };
                for await (const event of this.modalClient.execStream(
                    sandboxId,
                    ["npm", "test"],
                )) {
                    yield {
                        type: "agent-output",
                        content: event.data,
                    };
                }
            }

            // ─── 9. Cleanup and complete ───
            yield { type: "stage", stage: "Cleaning up..." };
            await this.cleanup(sandboxId, prompt.promptId);

            // Mark completed
            const execution = this.activeExecutions.get(
                prompt.promptId,
            );
            if (execution) {
                execution.status = "completed";
            }

            yield {
                type: "complete",
                result: {
                    promptId: prompt.promptId,
                    files: scopedChanges,
                    summary: `Applied ${scopedChanges.length} file(s)`,
                    sandboxId,
                },
            };
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : String(err);
            yield {
                type: "error",
                message: msg,
                recoverable: false,
            };
            await this.cleanup(sandboxId, prompt.promptId);
        }
    }

    /**
     * Cancel a running execution — terminates the sandbox.
     */
    async cancel(promptId: string): Promise<void> {
        const execution = this.activeExecutions.get(promptId);
        if (!execution) return;

        execution.status = "cancelled";
        await this.cleanup(
            execution.sandboxId,
            promptId,
        );
    }

    /**
     * Get all active executions.
     */
    getActiveExecutions(): AgentExecution[] {
        return [...this.activeExecutions.values()].filter(
            (e) => e.status === "running",
        );
    }

    /**
     * Check if we have capacity for another sandbox.
     */
    hasCapacity(): boolean {
        return (
            this.getActiveExecutions().length <
            MAX_CONCURRENT_SANDBOXES
        );
    }

    /**
     * Graceful shutdown — terminate all sandboxes and release
     * all locks.
     */
    async shutdown(): Promise<void> {
        const active = this.getActiveExecutions();
        for (const execution of active) {
            await this.cleanup(
                execution.sandboxId,
                execution.promptId,
            );
        }
        this.activeExecutions.clear();
    }

    // ─── Private helpers ───

    /**
     * Terminate sandbox and release file locks for a prompt.
     * Safe to call multiple times (idempotent).
     */
    private async cleanup(
        sandboxId: string,
        promptId: string,
    ): Promise<void> {
        try {
            await this.modalClient.terminate(sandboxId);
        } catch {
            // Sandbox may already be terminated — ignore
        }
        this.fileLocks.release(promptId);
        this.activeExecutions.delete(promptId);
    }

    /**
     * Apply file changes to the local project directory.
     *
     * Reads the new content from the diff changes and writes them
     * to disk. For the initial version, we apply the complete new
     * file content, not patches. This is safe because the sandbox
     * started from the exact same file content.
     *
     * Does NOT apply binary files.
     * Does NOT create files outside projectRoot.
     */
    private async applyChanges(
        changes: FileChange[],
    ): Promise<void> {
        for (const change of changes) {
            const absolutePath = join(
                this.projectRoot,
                change.path,
            );

            // Safety: ensure file is within project root
            if (
                !absolutePath.startsWith(this.projectRoot)
            ) {
                continue;
            }

            // Extract new content from unified diff
            const newContent =
                extractNewContentFromDiff(change.diff);
            if (newContent === null) continue;

            // Ensure parent directory exists
            await mkdir(dirname(absolutePath), {
                recursive: true,
            });
            await writeFile(absolutePath, newContent, "utf-8");
        }
    }
}

// ─── Helpers ───

/**
 * Build the agent command to run inside the sandbox.
 *
 * Default: claude --dangerously-skip-permissions -p "<prompt>"
 * Configurable via OVERMIND_AGENT_CMD / OVERMIND_AGENT_ARGS.
 */
function buildAgentCommand(prompt: PromptEntry): string[] {
    const cmd =
        process.env["OVERMIND_AGENT_CMD"] ?? "claude";
    const argsStr =
        process.env["OVERMIND_AGENT_ARGS"] ??
        "--dangerously-skip-permissions -p";
    const args = argsStr.split(" ");

    return [cmd, ...args, prompt.content];
}

/**
 * Extract the new file content from a unified diff.
 *
 * Collects lines that start with "+" (excluding the +++ header)
 * and lines that start with " " (context lines, unchanged).
 * Returns null if the diff can't be parsed.
 */
function extractNewContentFromDiff(
    diff: string,
): string | null {
    const lines = diff.split("\n");
    const newLines: string[] = [];
    let inHunk = false;

    for (const line of lines) {
        if (line.startsWith("@@")) {
            inHunk = true;
            continue;
        }
        if (!inHunk) continue;

        if (line.startsWith("+")) {
            // New line (not the +++ header)
            newLines.push(line.slice(1));
        } else if (line.startsWith(" ")) {
            // Context line (unchanged)
            newLines.push(line.slice(1));
        }
        // Lines starting with "-" are removed — skip them
    }

    if (newLines.length === 0) return null;
    return newLines.join("\n");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
