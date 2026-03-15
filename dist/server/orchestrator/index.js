/**
 * Purpose: Execute greenlit prompts via the Modal orchestrator and apply edits.
 * High-level behavior: Locks files, creates runs, polls status, applies diffs.
 * Assumptions: OVERMIND_ORCHESTRATOR_URL points to the orchestrator base URL.
 * Invariants: No out-of-scope files are written to the local project.
 */
import fs from "node:fs";
import { nanoid } from "nanoid";
import { ALWAYS_SYNC_PATTERNS, LOCK_RETRY_DELAY_MS, LOCK_TIMEOUT_MS, LOG_TRUNCATE_CHARS, OVERMIND_ORCHESTRATOR_POLL_MS, OVERMIND_ORCHESTRATOR_TIMEOUT_MS, OVERMIND_ORCHESTRATOR_URL, OVERMIND_WRITE_ALLOWLIST, } from "../../shared/constants.js";
import { FileLockManager } from "./file-lock.js";
import { packFiles } from "./file-sync.js";
import { ModalOrchestratorClient, } from "./modal-orchestrator-client.js";
import { buildAllowedPathChecker, normalizeRelativePath } from "./allowlist.js";
import { sleep, summarizeChanges } from "./helpers.js";
import { STAGE_ACQUIRE, STAGE_APPLY, STAGE_SPAWN, STAGE_SYNC, isAllowedRemoteStage, } from "./stages.js";
import { WorkspaceFiles } from "./workspace.js";
import { deriveProjectId } from "../../shared/project-id.js";
const LOG_FILE = "orchestrator.log";
const DEFAULT_STORY = "Overmind demo story: keep changes minimal, deterministic, and scoped.";
export class Orchestrator {
    projectRoot;
    fileLocks = new FileLockManager();
    activeExecutions = new Map();
    workspace;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        this.workspace = new WorkspaceFiles(projectRoot);
    }
    /**
     * Execute a greenlit prompt and yield progress events.
     * Does not broadcast to clients directly; caller maps events.
     * Edge cases: Invalid responses or timeouts yield error events.
     * Invariants: Locks are released and executions cleared on exit.
     */
    async *execute(prompt, evaluation) {
        const promptId = prompt.promptId;
        const mode = "modal";
        try {
            this.ensureOrchestratorConfigured();
            yield { type: "stage", stage: STAGE_ACQUIRE };
            for await (const event of this.acquireLocks(promptId, evaluation.affectedFiles)) {
                yield event;
            }
            this.trackExecution(promptId, mode);
            yield { type: "stage", stage: STAGE_SYNC };
            const runId = nanoid();
            const runPayload = this.buildRunPayload(runId, prompt, evaluation);
            const client = this.createClient(promptId);
            await client.createRun(runPayload.payload);
            yield { type: "stage", stage: STAGE_SPAWN };
            let runResult = null;
            for await (const event of this.pollRun(promptId, runId, client, STAGE_SPAWN)) {
                if (event.type === "run-complete") {
                    runResult = event.result;
                    break;
                }
                yield event;
            }
            if (!runResult) {
                throw new Error("Run ended without completion payload");
            }
            const filtered = this.filterAllowedFiles(promptId, runResult.files, evaluation);
            const changes = await this.workspace.buildFileChanges(runPayload.originals, filtered.allowed);
            yield { type: "stage", stage: STAGE_APPLY };
            await this.workspace.applyChanges(filtered.allowed);
            const summary = this.chooseSummary(changes, runResult.summary, filtered.rejected);
            yield {
                type: "complete",
                result: {
                    promptId,
                    files: changes,
                    summary,
                },
            };
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);
            this.log(promptId, mode, `error: ${message}`);
            yield { type: "error", message, recoverable: false };
        }
        finally {
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
    async *acquireLocks(promptId, affectedFiles) {
        const deadline = Date.now() + LOCK_TIMEOUT_MS;
        while (Date.now() < deadline) {
            const result = this.fileLocks.tryAcquire(promptId, affectedFiles);
            if (result.acquired)
                return;
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
    ensureOrchestratorConfigured() {
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
    createClient(promptId) {
        const normalizedUrl = OVERMIND_ORCHESTRATOR_URL()
            .replace(/\/+$/u, "")
            .replace(/\/runs$/u, "");
        const logFn = (message) => this.log(promptId, "modal", message);
        return new ModalOrchestratorClient(normalizedUrl, logFn);
    }
    /**
     * Build the run payload and capture original file contents.
     * Does not mutate the packFiles output.
     * Edge cases: Missing STORY.md falls back to a default story.
     * Invariants: Payload files are derived from packFiles.
     */
    buildRunPayload(runId, prompt, evaluation) {
        const pack = packFiles(this.projectRoot, evaluation, ALWAYS_SYNC_PATTERNS());
        const story = this.workspace.loadStory(DEFAULT_STORY, (message) => this.log(prompt.promptId, "modal", message));
        const payload = {
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
    async *pollRun(promptId, runId, client, initialStage) {
        const startTime = Date.now();
        let lastStage = initialStage;
        while (true) {
            const elapsed = Date.now() - startTime;
            if (elapsed > OVERMIND_ORCHESTRATOR_TIMEOUT_MS()) {
                await this.cancelRunSafely(promptId, runId, client);
                throw new Error("Orchestrator run timed out");
            }
            const status = await client.getRun(runId);
            this.logRunDetail(promptId, status);
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
     * Filter remote file updates by allowed scope.
     * Does not mutate the input file list.
     * Edge cases: Missing allowlist still allows affected files.
     * Invariants: Returned maps contain normalized paths only.
     */
    filterAllowedFiles(promptId, files, evaluation) {
        const isAllowedPath = buildAllowedPathChecker(evaluation, OVERMIND_WRITE_ALLOWLIST());
        const allowed = {};
        const rejected = [];
        for (const fileEntry of files) {
            const normalized = normalizeRelativePath(fileEntry.path);
            if (isAllowedPath(normalized)) {
                allowed[normalized] = fileEntry.content;
            }
            else {
                rejected.push(normalized);
            }
        }
        if (rejected.length > 0) {
            this.log(promptId, "modal", `warn: out-of-allowlist files ignored: ${rejected.join(", ")}`);
        }
        return { allowed, rejected };
    }
    /**
     * Choose a summary string for execution completion.
     * Does not log or mutate inputs.
     * Edge cases: Falls back when summary is empty.
     * Invariants: Returned summary is always non-empty.
     */
    chooseSummary(changes, summary, rejectedPaths) {
        if (rejectedPaths.length > 0) {
            return summarizeChanges(changes);
        }
        if (summary && summary.trim())
            return summary.trim();
        return summarizeChanges(changes);
    }
    /**
     * Cancel a run without throwing on failure.
     * Does not rethrow cancel errors.
     * Edge cases: Logs any cancel failures.
     * Invariants: Never interrupts the caller with cancel errors.
     */
    async cancelRunSafely(promptId, runId, client) {
        try {
            await client.cancelRun(runId);
        }
        catch (error) {
            this.log(promptId, "modal", `cancel failed: ${String(error)}`);
        }
    }
    /**
     * Log run detail messages without exposing prompt content.
     * Does not emit UI stages.
     * Edge cases: Ignores empty detail values.
     * Invariants: Logs include promptId context.
     */
    logRunDetail(promptId, status) {
        if (!status.detail)
            return;
        this.log(promptId, "modal", `detail: ${status.detail}`);
    }
    /**
     * Normalize a remote stage value.
     * Does not mutate input values.
     * Edge cases: Unknown stages return null.
     * Invariants: Only known stages are forwarded.
     */
    normalizeStage(stage) {
        if (!stage)
            return null;
        if (isAllowedRemoteStage(stage))
            return stage;
        return null;
    }
    /**
     * Track an execution in the active map.
     * Does not broadcast any status messages.
     * Edge cases: Overwrites existing records for the same prompt.
     * Invariants: Active executions contain promptId and mode.
     */
    trackExecution(promptId, mode) {
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
    async cancel(promptId) {
        this.fileLocks.release(promptId);
        this.activeExecutions.delete(promptId);
    }
    /**
     * Return a snapshot of active executions.
     * Does not expose internal mutable state.
     * Edge cases: Empty map returns an empty array.
     * Invariants: Snapshot values are copied.
     */
    getActiveExecutions() {
        return [...this.activeExecutions.values()];
    }
    /**
     * Shut down all active executions and release locks.
     * Does not attempt remote cancellations.
     * Edge cases: Clears all active executions.
     * Invariants: All tracked locks are released.
     */
    async shutdown() {
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
    log(promptId, mode, message) {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${promptId}] [${mode}] `
            + `${message.substring(0, LOG_TRUNCATE_CHARS)}\n`;
        try {
            fs.appendFileSync(LOG_FILE, line);
        }
        catch {
            // Logging failures must not crash execution.
        }
    }
}
//# sourceMappingURL=index.js.map