/**
 * Purpose: Run greenlit prompts via the remote orchestrator and apply results.
 * High-level behavior: Locks files, calls the orchestrator, applies diffs.
 * Assumptions: EvaluationResult.affectedFiles is a best-effort scope list.
 * Invariants: No out-of-scope files are written to the local project.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { PromptEntry } from "../party.js";
import type { EvaluationResult } from "../greenlight/evaluate.js";
import {
    ALWAYS_SYNC_PATTERNS,
    LOCK_RETRY_DELAY_MS,
    LOCK_TIMEOUT_MS,
    LOG_TRUNCATE_CHARS,
    OVERMIND_ORCHESTRATOR_TIMEOUT_MS,
    OVERMIND_ORCHESTRATOR_URL,
    OVERMIND_WRITE_ALLOWLIST,
} from "../../shared/constants.js";
import { FileLockManager } from "./file-lock.js";
import type { FileChange } from "./result.js";
import { buildFullDiff } from "./result.js";
import { packFiles } from "./file-sync.js";

const LOG_FILE = "orchestrator.log";

const RemoteFileSchema = z.object({
    path: z.string(),
    content: z.string(),
});

const RemoteResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string().optional(),
        summary: z.string().optional(),
        files: z.array(RemoteFileSchema).optional(),
    })
    .superRefine((data, ctx) => {
        if (data.success && !data.files) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "files required when success is true",
            });
        }
    });

export interface ExecutionEvent {
    type:
    | "queued"
    | "stage"
    | "agent-output"
    | "files-changed"
    | "complete"
    | "error";
    stage?: string;
    detail?: string;
    content?: string;
    stream?: "stdout" | "stderr";
    files?: FileChange[];
    result?: {
        promptId: string;
        files: FileChange[];
        summary: string;
        sandboxId?: string;
    };
    message?: string;
    recoverable?: boolean;
    reason?: string;
}

export interface AgentExecution {
    promptId: string;
    startedAt: number;
    mode: "modal" | "local";
}

/**
 * Summarize change counts for human-readable reporting.
 * Does not include file names or content.
 */
function summarizeChanges(changes: FileChange[]): string {
    const added = changes.reduce((sum, file) => sum + file.linesAdded, 0);
    const removed = changes.reduce((sum, file) => sum + file.linesRemoved, 0);
    return `Applied ${changes.length} file(s) (+${added}/-${removed}).`;
}

function normalizeRelativePath(relPath: string): string {
    return relPath.replace(/\\/g, "/");
}

function isSuffixPattern(pattern: string): boolean {
    return pattern.startsWith(".") && !pattern.includes("/");
}

function matchesAllowlistPattern(
    relPath: string,
    pattern: string
): boolean {
    const normalizedPath = normalizeRelativePath(relPath);
    const normalizedPattern = normalizeRelativePath(pattern);

    if (isSuffixPattern(normalizedPattern)) {
        return normalizedPath.endsWith(normalizedPattern);
    }
    if (normalizedPattern.includes("/")) {
        return normalizedPath === normalizedPattern;
    }
    return (
        normalizedPath.endsWith(`/${normalizedPattern}`)
        || normalizedPath === normalizedPattern
    );
}

function buildAllowedPathChecker(
    evaluation: EvaluationResult,
    allowlistPatterns: string[]
): (relPath: string) => boolean {
    const allowedPaths = new Set(
        evaluation.affectedFiles.map(normalizeRelativePath)
    );
    const normalizedAllowlist = allowlistPatterns.map((pattern) =>
        normalizeRelativePath(pattern)
    );

    return (relPath: string) => {
        const normalized = normalizeRelativePath(relPath);
        if (allowedPaths.has(normalized)) return true;
        return normalizedAllowlist.some((pattern) =>
            matchesAllowlistPattern(normalized, pattern)
        );
    };
}

async function fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export class Orchestrator {
    private projectRoot: string;
    private fileLocks = new FileLockManager();
    private activeExecutions: Map<string, AgentExecution> = new Map();

    constructor(projectRoot: string, _modalBridgeUrl: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Execute a greenlit prompt and yield progress events.
     * Does not broadcast to clients directly; caller maps events.
     */
    async *execute(
        prompt: PromptEntry,
        evaluation: EvaluationResult
    ): AsyncGenerator<ExecutionEvent> {
        const promptId = prompt.promptId;
        const mode = "modal";

        try {
            yield { type: "stage", stage: "Acquiring file locks..." };

            const deadline = Date.now() + LOCK_TIMEOUT_MS;
            let locked = false;
            while (Date.now() < deadline) {
                const result = this.fileLocks.tryAcquire(promptId, evaluation.affectedFiles);
                if (result.acquired) {
                    locked = true;
                    break;
                }
                yield { type: "queued", reason: "Waiting for file locks..." };
                await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
            }

            if (!locked) {
                throw new Error("Timed out waiting for file locks");
            }

            this.activeExecutions.set(promptId, {
                promptId,
                startedAt: Date.now(),
                mode: "modal",
            });

            yield {
                type: "stage",
                stage: "Sending context to Global Orchestrator on Modal...",
            };
            const pack = packFiles(
                this.projectRoot,
                evaluation,
                ALWAYS_SYNC_PATTERNS
            );

            const filePayload = Object.entries(pack.files).map(
                ([relPath, content]) => ({
                    path: relPath,
                    content,
                })
            );

            const response = await fetchWithTimeout(
                OVERMIND_ORCHESTRATOR_URL,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prompt: prompt.content,
                        files: filePayload,
                        scope: evaluation.affectedFiles,
                        promptId,
                    }),
                },
                OVERMIND_ORCHESTRATOR_TIMEOUT_MS
            );

            if (!response.ok) {
                throw new Error(
                    "Failed to reach Global Orchestrator: "
                        + `HTTP ${response.status}`
                );
            }

            let rawResponse: unknown;
            try {
                rawResponse = await response.json();
            } catch (err) {
                this.log(
                    promptId,
                    mode,
                    `invalid response: ${String(err)}`
                );
                throw new Error("Global Orchestrator returned invalid JSON");
            }

            const parsed = RemoteResponseSchema.safeParse(rawResponse);
            if (!parsed.success) {
                this.log(
                    promptId,
                    mode,
                    `invalid response schema: ${parsed.error.message}`
                );
                throw new Error(
                    "Global Orchestrator returned invalid response"
                );
            }

            const data = parsed.data;

            if (!data.success) {
                const errorDetail = data.error ?? "Unknown error";
                throw new Error(
                    `Global Orchestrator execution failed: ${errorDetail}`
                );
            }

            const updatedFilesRecord: Record<string, string> = {};
            for (const filePayloadEntry of data.files ?? []) {
                const normalized = normalizeRelativePath(
                    filePayloadEntry.path
                );
                updatedFilesRecord[normalized] = filePayloadEntry.content;
            }

            const isAllowedPath = buildAllowedPathChecker(
                evaluation,
                OVERMIND_WRITE_ALLOWLIST
            );
            const rejectedPaths: string[] = [];
            const filteredFilesRecord: Record<string, string> = {};

            for (const [relPath, content] of Object.entries(
                updatedFilesRecord
            )) {
                if (isAllowedPath(relPath)) {
                    filteredFilesRecord[relPath] = content;
                } else {
                    rejectedPaths.push(relPath);
                }
            }

            if (rejectedPaths.length > 0) {
                this.log(
                    promptId,
                    mode,
                    "warn: out-of-allowlist files ignored: "
                        + rejectedPaths.join(", ")
                );
            }

            const changes = this.collectChangedFiles(
                pack.originals,
                filteredFilesRecord
            );

            yield { type: "stage", stage: "Applying changes to codebase..." };
            await this.applyChanges(filteredFilesRecord);

            yield {
                type: "complete",
                result: {
                    promptId,
                    files: changes,
                    summary: rejectedPaths.length > 0
                        ? summarizeChanges(changes)
                        : data.summary || summarizeChanges(changes),
                },
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log(promptId, mode, `error: ${message}`);
            yield { type: "error", message, recoverable: false };
        } finally {
            this.fileLocks.release(promptId);
            this.activeExecutions.delete(promptId);
        }
    }

    /**
     * Build file changes by comparing originals to updated contents.
     * Does not include unchanged files.
     */
    private collectChangedFiles(
        originals: Record<string, string>,
        updated: Record<string, string>
    ): FileChange[] {
        const changes: FileChange[] = [];

        for (const [relPath, after] of Object.entries(updated)) {
            const before = originals[relPath] ?? "";
            const diff = buildFullDiff(relPath, before, after);
            if (diff) changes.push(diff);
        }

        return changes;
    }

    /**
     * Terminate an execution by prompt ID.
     * Only affects Modal executions with a sandbox ID.
     */
    async cancel(promptId: string): Promise<void> {
        this.fileLocks.release(promptId);
        this.activeExecutions.delete(promptId);
    }

    /**
     * Return a snapshot of active executions.
     * Does not expose internal mutable state.
     */
    getActiveExecutions(): AgentExecution[] {
        return [...this.activeExecutions.values()];
    }

    /**
     * Shut down all active executions and release locks.
     */
    async shutdown(): Promise<void> {
        const executions = [...this.activeExecutions.values()];
        for (const exec of executions) {
            this.fileLocks.release(exec.promptId);
            this.activeExecutions.delete(exec.promptId);
        }
    }

    /**
     * Append an orchestrator event to the log file.
     * Does not throw on IO failures.
     */
    private log(promptId: string, mode: string, message: string): void {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${promptId}] [${mode}] ${message.substring(0, LOG_TRUNCATE_CHARS)}\n`;
        try {
            fs.appendFileSync(LOG_FILE, line);
        } catch {
            // Logging failures must not crash execution.
        }
    }

    /**
     * Ensure a directory exists by creating it recursively.
     * Does not remove existing files.
     */
    private ensureDir(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * Resolve a relative path and prevent root escape.
     * Throws if the path escapes the project root.
     */
    private safeResolve(projectRoot: string, relPath: string): string {
        const absolute = path.resolve(projectRoot, relPath);
        if (!absolute.startsWith(projectRoot)) {
            throw new Error("Path escapes project root");
        }
        return absolute;
    }

    /**
     * Apply updated file contents to the local project.
     * Does not write files outside the project root.
     */
    private async applyChanges(
        updatedFiles: Record<string, string>
    ): Promise<void> {
        for (const [relPath, content] of Object.entries(updatedFiles)) {
            const absPath = this.safeResolve(this.projectRoot, relPath);
            this.ensureDir(path.dirname(absPath));
            fs.writeFileSync(absPath, content, "utf-8");
        }
    }
}
