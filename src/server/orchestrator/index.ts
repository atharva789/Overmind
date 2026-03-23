/**
 * Purpose: Execute greenlit prompts via the Modal orchestrator and apply edits.
 * High-level behavior: Locks files, creates runs, polls status, applies diffs.
 * Assumptions: OVERMIND_ORCHESTRATOR_URL points to the orchestrator base URL.
 * Invariants: No out-of-scope files are written to the local project.
 */

import fs from "node:fs";
import WebSocket from "ws";
import { nanoid } from "nanoid";
import type { PromptEntry } from "../party.js";
import type { EvaluationResult } from "../../shared/protocol.js";
import {
    ALWAYS_SYNC_PATTERNS,
    LOCK_RETRY_DELAY_MS,
    LOCK_TIMEOUT_MS,
    LOG_TRUNCATE_CHARS,
    OVERMIND_ORCHESTRATOR_POLL_MS,
    OVERMIND_ORCHESTRATOR_TIMEOUT_MS,
    OVERMIND_ORCHESTRATOR_URL,
    OVERMIND_WRITE_ALLOWLIST,
} from "../../shared/constants.js";
import { FileLockManager } from "./file-lock.js";
import type { FileChange } from "./result.js";
import { packFiles } from "./file-sync.js";
import {
    ModalOrchestratorClient,
    type RunCreatePayload,
    type RunStatus,
} from "./modal-orchestrator-client.js";
import { buildAllowedPathChecker, normalizeRelativePath } from "./allowlist.js";
import { sleep, summarizeChanges } from "./helpers.js";
import {
    STAGE_ACQUIRE,
    STAGE_APPLY,
    STAGE_SPAWN,
    STAGE_SYNC,
    isAllowedRemoteStage,
} from "./stages.js";
import { WorkspaceFiles } from "./workspace.js";

import { deriveProjectId } from "../../shared/project-id.js";

const LOG_FILE = "orchestrator.log";
const DEFAULT_STORY =
    "Overmind demo story: keep changes minimal, deterministic, and scoped.";

export interface ExecutionEvent {
    type:
    | "queued"
    | "stage"
    | "agent-output"
    | "files-changed"
    | "complete"
    | "error"
    | "plan-ready"
    | "agent-spawned"
    | "agent-finished"
    | "tool-activity"
    | "agent-thinking"
    | "run-complete";
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
    // Streaming event fields
    tasks?: Array<{ taskIndex: number; taskName: string; taskDescription: string }>;
    taskIndex?: number;
    taskName?: string;
    status?: "spawned" | "working" | "finished";
    summary?: string;
    filesChanged?: string[];
    toolName?: string;
    phase?: "start" | "result";
    success?: boolean;
    outputPreview?: string;
    thinking?: string;
}

export interface AgentExecution {
    promptId: string;
    startedAt: number;
    mode: "modal" | "local";
}

interface RunCompletion {
    files: Array<{ path: string; content?: string }>;
    summary: string | null;
}

type RunPollEvent =
    | ExecutionEvent
    | { type: "run-complete"; result: RunCompletion };

export class Orchestrator {
    private projectRoot: string;
    private fileLocks = new FileLockManager();
    private activeExecutions: Map<string, AgentExecution> = new Map();
    private workspace: WorkspaceFiles;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.workspace = new WorkspaceFiles(projectRoot);
    }

    /**
     * Execute a greenlit prompt and yield progress events.
     * Does not broadcast to clients directly; caller maps events.
     * Edge cases: Invalid responses or timeouts yield error events.
     * Invariants: Locks are released and executions cleared on exit.
     */
    async *execute(
        prompt: PromptEntry,
        evaluation: EvaluationResult
    ): AsyncGenerator<ExecutionEvent> {
        const promptId = prompt.promptId;
        const mode = "modal";

        try {
            this.ensureOrchestratorConfigured();
            yield { type: "stage", stage: STAGE_ACQUIRE };

            for await (const event of this.acquireLocks(
                promptId,
                evaluation.affectedFiles
            )) {
                yield event;
            }

            this.trackExecution(promptId, mode);
            yield { type: "stage", stage: STAGE_SYNC };

            const runId = nanoid();
            const runPayload = this.buildRunPayload(
                runId,
                prompt,
                evaluation
            );
            const client = this.createClient(promptId);

            await client.createRun(runPayload.payload);
            yield { type: "stage", stage: STAGE_SPAWN };

            let runResult: RunCompletion | null = null;

            // Stream events in real-time via WebSocket
            try {
                for await (const event of this.streamRun(promptId, runId)) {
                    if (event.type === "run-complete" || event.type === "error") {
                        if (event.type === "error") {
                            throw new Error(event.message ?? "Agent execution failed");
                        }
                        break;
                    }
                    yield event;
                }

                // Stream finished — fetch final result with file contents
                const status = await client.getRun(runId);
                runResult = {
                    files: status.files ?? [],
                    summary: status.summary ?? null,
                };
            } catch (streamErr) {
                // WS failed — fall back to poll loop
                this.log(promptId, mode, `ws stream failed: ${streamErr}, falling back to poll`);
                for await (const event of this.pollRun(
                    promptId, runId, client, STAGE_SPAWN
                )) {
                    if (event.type === "run-complete" && "result" in event && event.result) {
                        runResult = event.result as RunCompletion;
                        break;
                    }
                    yield event as ExecutionEvent;
                }
            }

            if (!runResult) {
                throw new Error("Run ended without completion payload");
            }

            const filtered = this.filterAllowedFiles(
                promptId,
                runResult.files,
                evaluation
            );

            const changes = await this.workspace.buildFileChanges(
                runPayload.originals,
                filtered.allowed
            );

            yield { type: "stage", stage: STAGE_APPLY };
            await this.workspace.applyChanges(filtered.allowed);

            const summary = this.chooseSummary(
                changes,
                runResult.summary,
                filtered.rejected
            );

            yield {
                type: "complete",
                result: {
                    promptId,
                    files: changes,
                    summary,
                },
            };
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            this.log(promptId, mode, `error: ${message}`);
            yield { type: "error", message, recoverable: false };
        } finally {
            this.fileLocks.release(promptId);
            this.activeExecutions.delete(promptId);
        }
    }

    /**
     * Acquire file locks with retry delays.
     * Does not mutate files or enqueue executions.
     * Edge cases: Throws on timeout expiry.
     * Invariants: Locks are held only on successful acquisition.
     */
    private async *acquireLocks(
        promptId: string,
        affectedFiles: string[]
    ): AsyncGenerator<ExecutionEvent> {
        const deadline = Date.now() + LOCK_TIMEOUT_MS;

        while (Date.now() < deadline) {
            const result = this.fileLocks.tryAcquire(
                promptId,
                affectedFiles
            );
            if (result.acquired) return;
            yield { type: "queued", reason: "Waiting for file locks..." };
            await sleep(LOCK_RETRY_DELAY_MS);
        }

        throw new Error("Timed out waiting for file locks");
    }

    /**
     * Ensure the orchestrator URL is configured.
     * Does not attempt fallback behavior.
     * Edge cases: Throws when URL is missing.
     * Invariants: No remote calls occur when configuration is missing.
     */
    private ensureOrchestratorConfigured(): void {
        if (!OVERMIND_ORCHESTRATOR_URL().trim()) {
            throw new Error("OVERMIND_ORCHESTRATOR_URL is not configured");
        }
    }

    /**
     * Create a ModalOrchestratorClient bound to this prompt.
     * Does not log prompt content.
     * Edge cases: Strips trailing /runs if present.
     * Invariants: Client uses the normalized base URL.
     */
    private createClient(promptId: string): ModalOrchestratorClient {
        const normalizedUrl = OVERMIND_ORCHESTRATOR_URL()
            .replace(/\/+$/u, "")
            .replace(/\/runs$/u, "");
        const logFn = (message: string) =>
            this.log(promptId, "modal", message);
        return new ModalOrchestratorClient(normalizedUrl, logFn);
    }

    /**
     * Build the run payload and capture original file contents.
     * Does not mutate the packFiles output.
     * Edge cases: Missing STORY.md falls back to a default story.
     * Invariants: Payload files are derived from packFiles.
     */
    private buildRunPayload(
        runId: string,
        prompt: PromptEntry,
        evaluation: EvaluationResult
    ): { payload: RunCreatePayload; originals: Record<string, string> } {
        const pack = packFiles(
            this.projectRoot,
            evaluation,
            ALWAYS_SYNC_PATTERNS()
        );

        const story = this.workspace.loadStory(
            DEFAULT_STORY,
            (message) => this.log(prompt.promptId, "modal", message)
        );
        const payload: RunCreatePayload = {
            runId,
            promptId: prompt.promptId,
            prompt: prompt.content,
            story,
            scope: [...evaluation.affectedFiles],
            files: { ...pack.files },
            projectId: deriveProjectId(this.projectRoot),
        };

        return { payload, originals: { ...pack.originals } };
    }

    /**
     * Iterate run status updates and emit stage events.
     * Does not handle local file writes.
     * Edge cases: Throws on failed or canceled runs.
     * Invariants: Completion yields a run-complete event.
     */
    private async *pollRun(
        promptId: string,
        runId: string,
        client: ModalOrchestratorClient,
        initialStage: string | null
    ): AsyncGenerator<RunPollEvent> {
        const startTime = Date.now();
        let lastStage: string | null = initialStage;

        while (true) {
            const elapsed = Date.now() - startTime;
            if (elapsed > OVERMIND_ORCHESTRATOR_TIMEOUT_MS()) {
                await this.cancelRunSafely(promptId, runId, client);
                throw new Error("Orchestrator run timed out");
            }

            const status = await client.getRun(runId);
            this.logRunDetail(promptId, status);

            // Yield streaming events from poll response (no WS dependency)
            if (status.events) {
                for (const raw of status.events) {
                    const mapped = this.mapStreamEvent(raw as Record<string, unknown>);
                    if (mapped) yield mapped;
                }
            }

            const stage = this.normalizeStage(status.stage);
            if (stage && stage !== lastStage) {
                lastStage = stage;
                yield { type: "stage", stage };
            }

            if (status.status === "completed") {
                const files = status.files ?? [];
                const summary = status.summary ?? null;
                yield { type: "run-complete", result: { files, summary } };
                return;
            }

            if (status.status === "failed" || status.status === "canceled") {
                const errorDetail = status.error
                    ?? `Run ${status.status}`;
                throw new Error(errorDetail);
            }

            await sleep(OVERMIND_ORCHESTRATOR_POLL_MS());
        }
    }

    /**
     * Stream real-time events from the orchestrator via WebSocket.
     * Yields events as they arrive. Returns on terminal events or WS close.
     * Throws if the connection cannot be established.
     */
    private async *streamRun(
        promptId: string,
        runId: string,
    ): AsyncGenerator<ExecutionEvent> {
        const baseUrl = OVERMIND_ORCHESTRATOR_URL()
            .replace(/\/+$/u, "")
            .replace(/^http/u, "ws");
        const wsUrl = `${baseUrl}/runs/${runId}/ws`;

        const ws = new WebSocket(wsUrl);

        // Async queue: WS callbacks push, generator awaits
        const pending: ExecutionEvent[] = [];
        let notify: (() => void) | null = null;
        let closed = false;
        let wsError: Error | null = null;

        const push = (event: ExecutionEvent) => {
            pending.push(event);
            notify?.();
        };

        const waitForEvent = () =>
            new Promise<void>((resolve) => { notify = resolve; });

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
            ws.on("open", () => {
                this.log(promptId, "modal", "ws stream: connected");
                resolve();
            });
            ws.on("error", (err: Error) => {
                reject(err);
            });
        });

        ws.on("message", (data: Buffer) => {
            try {
                const raw = JSON.parse(data.toString());
                const mapped = this.mapStreamEvent(raw);
                if (mapped) push(mapped);
            } catch {
                // skip malformed
            }
        });

        ws.on("close", () => {
            closed = true;
            notify?.();
        });

        ws.on("error", (err: Error) => {
            wsError = err;
            closed = true;
            notify?.();
        });

        try {
            while (!closed || pending.length > 0) {
                if (pending.length === 0 && !closed) {
                    await waitForEvent();
                }
                while (pending.length > 0) {
                    const event = pending.shift()!;
                    yield event;
                    if (event.type === "run-complete" || event.type === "error") {
                        return;
                    }
                }
            }
            if (wsError) throw wsError;
        } finally {
            if (ws.readyState === WebSocket.OPEN) ws.close();
        }
    }

    /**
     * Map a raw Python stream event (snake_case) to an ExecutionEvent.
     * Returns null for unrecognized event types.
     */
    private mapStreamEvent(raw: Record<string, unknown>): ExecutionEvent | null {
        const t = raw.event_type as string;
        switch (t) {
            case "plan-ready":
                return { type: "plan-ready", tasks: raw.tasks as ExecutionEvent["tasks"] };
            case "agent-spawned":
                return {
                    type: "agent-spawned",
                    taskIndex: raw.task_index as number,
                    taskName: raw.task_name as string,
                    status: "spawned",
                };
            case "agent-finished":
                return {
                    type: "agent-finished",
                    taskIndex: raw.task_index as number,
                    taskName: raw.task_name as string,
                    status: "finished",
                    summary: raw.summary as string,
                    filesChanged: raw.files_changed as string[],
                };
            case "tool-use":
                return {
                    type: "tool-activity",
                    taskIndex: raw.task_index as number,
                    taskName: raw.task_name as string,
                    toolName: raw.tool_name as string,
                    phase: "start",
                };
            case "tool-result":
                return {
                    type: "tool-activity",
                    taskIndex: raw.task_index as number,
                    taskName: raw.task_name as string,
                    toolName: raw.tool_name as string,
                    phase: "result",
                    success: raw.success as boolean,
                    outputPreview: raw.output_preview as string,
                };
            case "agent-thinking":
                return {
                    type: "agent-thinking",
                    taskIndex: raw.task_index as number,
                    taskName: raw.task_name as string,
                    thinking: raw.content as string,
                };
            case "run-complete":
                return { type: "run-complete" };
            case "run-error":
                return { type: "error", message: raw.error as string };
            default:
                return null;
        }
    }

    /**
     * Filter remote file updates by allowed scope.
     * Does not mutate the input file list.
     * Edge cases: Missing allowlist still allows affected files.
     * Invariants: Returned maps contain normalized paths only.
     */
    private filterAllowedFiles(
        promptId: string,
        files: Array<{ path: string; content?: string }>,
        evaluation: EvaluationResult
    ): { allowed: Record<string, string>; rejected: string[] } {
        const isAllowedPath = buildAllowedPathChecker(
            evaluation,
            OVERMIND_WRITE_ALLOWLIST()
        );
        const allowed: Record<string, string> = {};
        const rejected: string[] = [];

        this.log(
            promptId,
            "modal",
            `affectedFiles=[${evaluation.affectedFiles.join(", ")}]`
        );

        for (const fileEntry of files) {
            const normalized = normalizeRelativePath(fileEntry.path);
            const accepted = isAllowedPath(normalized);
            this.log(
                promptId,
                "modal",
                `file: raw="${fileEntry.path}" `
                    + `norm="${normalized}" allowed=${accepted}`
            );
            if (accepted) {
                allowed[normalized] = fileEntry.content ?? "";
            } else {
                rejected.push(normalized);
            }
        }

        if (rejected.length > 0) {
            this.log(
                promptId,
                "modal",
                `warn: out-of-allowlist files ignored: ${rejected.join(", ")}`
            );
        }

        return { allowed, rejected };
    }


    /**
     * Choose a summary string for execution completion.
     * Does not log or mutate inputs.
     * Edge cases: Falls back when summary is empty.
     * Invariants: Returned summary is always non-empty.
     */
    private chooseSummary(
        changes: FileChange[],
        summary: string | null,
        rejectedPaths: string[]
    ): string {
        if (rejectedPaths.length > 0) {
            return summarizeChanges(changes);
        }
        if (summary && summary.trim()) return summary.trim();
        return summarizeChanges(changes);
    }

    /**
     * Cancel a run without throwing on failure.
     * Does not rethrow cancel errors.
     * Edge cases: Logs any cancel failures.
     * Invariants: Never interrupts the caller with cancel errors.
     */
    private async cancelRunSafely(
        promptId: string,
        runId: string,
        client: ModalOrchestratorClient
    ): Promise<void> {
        try {
            await client.cancelRun(runId);
        } catch (error) {
            this.log(
                promptId,
                "modal",
                `cancel failed: ${String(error)}`
            );
        }
    }

    /**
     * Log run detail messages without exposing prompt content.
     * Does not emit UI stages.
     * Edge cases: Ignores empty detail values.
     * Invariants: Logs include promptId context.
     */
    private logRunDetail(promptId: string, status: RunStatus): void {
        if (!status.detail) return;
        this.log(promptId, "modal", `detail: ${status.detail}`);
    }

    /**
     * Normalize a remote stage value.
     * Does not mutate input values.
     * Edge cases: Unknown stages return null.
     * Invariants: Only known stages are forwarded.
     */
    private normalizeStage(stage?: string): string | null {
        if (!stage) return null;
        if (isAllowedRemoteStage(stage)) return stage;
        return null;
    }

    /**
     * Track an execution in the active map.
     * Does not broadcast any status messages.
     * Edge cases: Overwrites existing records for the same prompt.
     * Invariants: Active executions contain promptId and mode.
     */
    private trackExecution(promptId: string, mode: "modal" | "local"): void {
        this.activeExecutions.set(promptId, {
            promptId,
            startedAt: Date.now(),
            mode,
        });
    }

    /**
     * Terminate an execution by prompt ID.
     * Does not attempt remote cancellations.
     * Edge cases: Missing prompt IDs are ignored.
     * Invariants: Locks are released for the prompt.
     */
    async cancel(promptId: string): Promise<void> {
        this.fileLocks.release(promptId);
        this.activeExecutions.delete(promptId);
    }

    /**
     * Return a snapshot of active executions.
     * Does not expose internal mutable state.
     * Edge cases: Empty map returns an empty array.
     * Invariants: Snapshot values are copied.
     */
    getActiveExecutions(): AgentExecution[] {
        return [...this.activeExecutions.values()];
    }

    /**
     * Shut down all active executions and release locks.
     * Does not attempt remote cancellations.
     * Edge cases: Clears all active executions.
     * Invariants: All tracked locks are released.
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
     * Edge cases: Truncates long messages for privacy.
     * Invariants: Logs always include timestamps.
     */
    private log(promptId: string, mode: string, message: string): void {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${promptId}] [${mode}] `
            + `${message.substring(0, LOG_TRUNCATE_CHARS)}\n`;
        try {
            fs.appendFileSync(LOG_FILE, line);
        } catch {
            // Logging failures must not crash execution.
        }
    }
}
