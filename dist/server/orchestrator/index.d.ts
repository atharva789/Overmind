/**
 * Purpose: Execute greenlit prompts via the Modal orchestrator and apply edits.
 * High-level behavior: Locks files, creates runs, polls status, applies diffs.
 * Assumptions: OVERMIND_ORCHESTRATOR_URL points to the orchestrator base URL.
 * Invariants: No out-of-scope files are written to the local project.
 */
import type { PromptEntry } from "../party.js";
import type { EvaluationResult } from "../../shared/protocol.js";
import type { FileChange } from "./result.js";
export interface ExecutionEvent {
    type: "queued" | "stage" | "agent-output" | "files-changed" | "complete" | "error";
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
export declare class Orchestrator {
    private projectRoot;
    private fileLocks;
    private activeExecutions;
    private workspace;
    constructor(projectRoot: string);
    /**
     * Execute a greenlit prompt and yield progress events.
     * Does not broadcast to clients directly; caller maps events.
     * Edge cases: Invalid responses or timeouts yield error events.
     * Invariants: Locks are released and executions cleared on exit.
     */
    execute(prompt: PromptEntry, evaluation: EvaluationResult): AsyncGenerator<ExecutionEvent>;
    /**
     * Acquire file locks with retry delays.
     * Does not mutate files or enqueue executions.
     * Edge cases: Throws on timeout expiry.
     * Invariants: Locks are held only on successful acquisition.
     */
    private acquireLocks;
    /**
     * Ensure the orchestrator URL is configured.
     * Does not attempt fallback behavior.
     * Edge cases: Throws when URL is missing.
     * Invariants: No remote calls occur when configuration is missing.
     */
    private ensureOrchestratorConfigured;
    /**
     * Create a ModalOrchestratorClient bound to this prompt.
     * Does not log prompt content.
     * Edge cases: Strips trailing /runs if present.
     * Invariants: Client uses the normalized base URL.
     */
    private createClient;
    /**
     * Build the run payload and capture original file contents.
     * Does not mutate the packFiles output.
     * Edge cases: Missing STORY.md falls back to a default story.
     * Invariants: Payload files are derived from packFiles.
     */
    private buildRunPayload;
    /**
     * Iterate run status updates and emit stage events.
     * Does not handle local file writes.
     * Edge cases: Throws on failed or canceled runs.
     * Invariants: Completion yields a run-complete event.
     */
    private pollRun;
    /**
     * Filter remote file updates by allowed scope.
     * Does not mutate the input file list.
     * Edge cases: Missing allowlist still allows affected files.
     * Invariants: Returned maps contain normalized paths only.
     */
    private filterAllowedFiles;
    /**
     * Choose a summary string for execution completion.
     * Does not log or mutate inputs.
     * Edge cases: Falls back when summary is empty.
     * Invariants: Returned summary is always non-empty.
     */
    private chooseSummary;
    /**
     * Cancel a run without throwing on failure.
     * Does not rethrow cancel errors.
     * Edge cases: Logs any cancel failures.
     * Invariants: Never interrupts the caller with cancel errors.
     */
    private cancelRunSafely;
    /**
     * Log run detail messages without exposing prompt content.
     * Does not emit UI stages.
     * Edge cases: Ignores empty detail values.
     * Invariants: Logs include promptId context.
     */
    private logRunDetail;
    /**
     * Normalize a remote stage value.
     * Does not mutate input values.
     * Edge cases: Unknown stages return null.
     * Invariants: Only known stages are forwarded.
     */
    private normalizeStage;
    /**
     * Track an execution in the active map.
     * Does not broadcast any status messages.
     * Edge cases: Overwrites existing records for the same prompt.
     * Invariants: Active executions contain promptId and mode.
     */
    private trackExecution;
    /**
     * Terminate an execution by prompt ID.
     * Does not attempt remote cancellations.
     * Edge cases: Missing prompt IDs are ignored.
     * Invariants: Locks are released for the prompt.
     */
    cancel(promptId: string): Promise<void>;
    /**
     * Return a snapshot of active executions.
     * Does not expose internal mutable state.
     * Edge cases: Empty map returns an empty array.
     * Invariants: Snapshot values are copied.
     */
    getActiveExecutions(): AgentExecution[];
    /**
     * Shut down all active executions and release locks.
     * Does not attempt remote cancellations.
     * Edge cases: Clears all active executions.
     * Invariants: All tracked locks are released.
     */
    shutdown(): Promise<void>;
    /**
     * Append an orchestrator event to the log file.
     * Does not throw on IO failures.
     * Edge cases: Truncates long messages for privacy.
     * Invariants: Logs always include timestamps.
     */
    private log;
}
