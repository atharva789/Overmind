/**
 * Purpose: Run greenlit prompts in Modal or local mode and apply results.
 * High-level behavior: Locks files, runs agent command, applies diffs.
 * Assumptions: EvaluationResult.affectedFiles is a best-effort scope list.
 * Invariants: No out-of-scope files are written to the local project.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import type { PromptEntry } from "../party.js";
import type { EvaluationResult } from "../greenlight/evaluate.js";
import {
    AGENT_ARGS,
    AGENT_CMD,
    AGENT_TIMEOUT_S,
    ALWAYS_SYNC_PATTERNS,
    LOCK_RETRY_DELAY_MS,
    LOCK_TIMEOUT_MS,
    LOG_TRUNCATE_CHARS,
    MAX_CONCURRENT_SANDBOXES,
} from "../../shared/constants.js";
import { FileLockManager } from "./file-lock.js";
import { ModalClient } from "./modal-client.js";
import type { FileChange } from "./result.js";
import { buildFullDiff, normalizeDiffChanges } from "./result.js";
import { packFiles, type FilePack } from "./file-sync.js";

const LOG_FILE = "orchestrator.log";
const LOCAL_WORK_DIR = ".overmind/workspaces";

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
    sandboxId?: string;
    startedAt: number;
    mode: "modal" | "local";
}

interface ExecutionOutcome {
    files: FileChange[];
    updatedFiles: Record<string, string>;
    sandboxId?: string;
}

/**
 * Truncate log strings for privacy and readability.
 * Does not modify the original string value.
 */
function truncate(text: string): string {
    if (text.length <= LOG_TRUNCATE_CHARS) return text;
    return `${text.slice(0, LOG_TRUNCATE_CHARS)}…`;
}

/**
 * Build the agent command array from environment configuration.
 * Does not validate that the command exists.
 */
function buildAgentCommand(): string[] {
    return [AGENT_CMD, ...AGENT_ARGS.filter((arg) => arg.length > 0)];
}

/**
 * Build environment variables passed to the execution agent.
 * Does not include secrets unless present in process env.
 */
function buildAgentEnv(
    prompt: PromptEntry,
    evaluation: EvaluationResult
): Record<string, string> {
    const env: Record<string, string> = {
        OVERMIND_PROMPT_ID: prompt.promptId,
        OVERMIND_SCOPE: evaluation.affectedFiles.join(","),
        OVERMIND_PROMPT: prompt.content,
    };

    if (process.env["ANTHROPIC_API_KEY"]) {
        env["ANTHROPIC_API_KEY"] = process.env["ANTHROPIC_API_KEY"]!;
    }
    if (process.env["GEMINI_API_KEY"]) {
        env["GEMINI_API_KEY"] = process.env["GEMINI_API_KEY"]!;
    }

    return env;
}

/**
 * Ensure a directory exists by creating it recursively.
 * Does not remove existing files.
 */
function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Resolve a relative path and prevent root escape.
 * Throws if the path escapes the project root.
 */
function safeResolve(projectRoot: string, relPath: string): string {
    const absolute = path.resolve(projectRoot, relPath);
    if (!absolute.startsWith(projectRoot)) {
        throw new Error("Path escapes project root");
    }
    return absolute;
}

/**
 * Build file changes by comparing originals to updated contents.
 * Does not include unchanged files.
 */
function collectChangedFiles(
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
 * Summarize change counts for human-readable reporting.
 * Does not include file names or content.
 */
function summarizeChanges(changes: FileChange[]): string {
    const added = changes.reduce((sum, file) => sum + file.linesAdded, 0);
    const removed = changes.reduce((sum, file) => sum + file.linesRemoved, 0);
    return `Applied ${changes.length} file(s) (+${added}/-${removed}).`;
}

/**
 * Determine whether the git working tree is dirty.
 * Falls back to git CLI if simple-git is unavailable.
 */
async function isWorkingTreeDirty(projectRoot: string): Promise<boolean> {
    try {
        const mod = await import("simple-git");
        const factory = mod.default ?? mod;
        const git = factory({ baseDir: projectRoot });
        const status = await git.status();
        return status.files.length > 0;
    } catch {
        try {
            const output = execSync("git status --porcelain", {
                cwd: projectRoot,
                stdio: ["ignore", "pipe", "ignore"],
            }).toString();
            return output.trim().length > 0;
        } catch {
            return true;
        }
    }
}

export class Orchestrator {
    private projectRoot: string;
    private modalClient: ModalClient;
    private fileLocks = new FileLockManager();
    private activeExecutions: Map<string, AgentExecution> = new Map();

    constructor(projectRoot: string, modalBridgeUrl: string) {
        this.projectRoot = projectRoot;
        this.modalClient = new ModalClient(modalBridgeUrl);
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
        const mode = this.resolveMode();

        try {
            yield { type: "stage", stage: "Acquiring file locks..." };

            for await (const evt of this.waitForLocks(promptId, evaluation)) {
                yield evt;
            }

            for await (const evt of this.waitForSlot(promptId, mode)) {
                yield evt;
            }

            yield {
                type: "stage",
                stage: "Syncing project files to sandbox...",
            };
            const pack = packFiles(
                this.projectRoot,
                evaluation,
                ALWAYS_SYNC_PATTERNS
            );

            const outcome = mode === "modal"
                ? yield* this.runModalFlow(prompt, evaluation, pack)
                : yield* this.runLocalFlow(prompt, evaluation, pack);

            yield { type: "stage", stage: "Applying changes to codebase..." };
            await this.applyChanges(outcome.updatedFiles);

            yield {
                type: "complete",
                result: {
                    promptId,
                    files: outcome.files,
                    summary: summarizeChanges(outcome.files),
                    sandboxId: outcome.sandboxId,
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
     * Terminate an execution by prompt ID.
     * Only affects Modal executions with a sandbox ID.
     */
    async cancel(promptId: string): Promise<void> {
        const execution = this.activeExecutions.get(promptId);
        if (!execution?.sandboxId) return;
        await this.modalClient.terminate(execution.sandboxId);
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
            if (exec.sandboxId) {
                await this.modalClient.terminate(exec.sandboxId);
            }
            this.fileLocks.release(exec.promptId);
            this.activeExecutions.delete(exec.promptId);
        }
    }

    private resolveMode(): "modal" | "local" {
        return process.env["OVERMIND_LOCAL"] === "1" ? "local" : "modal";
    }

    /**
     * Append an orchestrator event to the log file.
     * Does not throw on IO failures.
     */
    private log(promptId: string, mode: string, message: string): void {
        const ts = new Date().toISOString();
        const line = `[${ts}] [${promptId}] [${mode}] ${truncate(message)}\n`;
        try {
            fs.appendFileSync(LOG_FILE, line);
        } catch {
            // Logging failures must not crash execution.
        }
    }

    /**
     * Wait for a sandbox slot to become available.
     * Reserves a slot before returning.
     */
    private async *waitForSlot(
        promptId: string,
        mode: "modal" | "local"
    ): AsyncGenerator<ExecutionEvent> {
        while (true) {
            if (this.activeExecutions.size < MAX_CONCURRENT_SANDBOXES) {
                if (!this.activeExecutions.has(promptId)) {
                    this.activeExecutions.set(promptId, {
                        promptId,
                        startedAt: Date.now(),
                        mode,
                    });
                }
                return;
            }

            this.log(promptId, mode, "waiting for sandbox slot");
            yield {
                type: "queued",
                reason: "Waiting for sandbox slot...",
            };
            await sleep(LOCK_RETRY_DELAY_MS);
        }
    }

    /**
     * Wait for file locks with a deterministic timeout.
     * Does not acquire locks beyond the configured timeout.
     */
    private async *waitForLocks(
        promptId: string,
        evaluation: EvaluationResult
    ): AsyncGenerator<ExecutionEvent> {
        const deadline = Date.now() + LOCK_TIMEOUT_MS;
        const paths = evaluation.affectedFiles;

        while (Date.now() < deadline) {
            const result = this.fileLocks.tryAcquire(promptId, paths);
            if (result.acquired) return;

            yield {
                type: "queued",
                reason: "Waiting for file locks...",
            };

            await sleep(LOCK_RETRY_DELAY_MS);
        }

        throw new Error("Timed out waiting for file locks");
    }

    /**
     * Create a Modal sandbox and record execution tracking.
     * Does not run the agent inside the sandbox.
     */
    private async createModalSandbox(
        prompt: PromptEntry,
        evaluation: EvaluationResult,
        pack: FilePack
    ): Promise<string> {
        const promptId = prompt.promptId;
        this.log(promptId, "modal", "creating sandbox");

        const env = buildAgentEnv(prompt, evaluation);
        const sandboxId = await this.modalClient.createSandbox({
            image: evaluation.executionHints.requiresBuild ? "build" : "base",
            files: pack.files,
            env,
            timeout_s: AGENT_TIMEOUT_S,
        });

        const existing = this.activeExecutions.get(promptId);
        if (existing) {
            existing.sandboxId = sandboxId;
        } else {
            this.activeExecutions.set(promptId, {
                promptId,
                sandboxId,
                startedAt: Date.now(),
                mode: "modal",
            });
        }

        return sandboxId;
    }

    /**
     * Collect diffs and updated files from a Modal sandbox.
     * Terminates the sandbox before returning.
     */
    private async collectModalOutcome(
        sandboxId: string,
        evaluation: EvaluationResult,
        pack: FilePack
    ): Promise<ExecutionOutcome> {
        const diffChanges = await this.modalClient.getDiff(
            sandboxId,
            pack.originals,
            evaluation.affectedFiles
        );

        const updatedFiles = await this.modalClient.getFiles(
            sandboxId,
            evaluation.affectedFiles
        );

        const normalized = normalizeDiffChanges(diffChanges);
        await this.modalClient.terminate(sandboxId);

        return { files: normalized, updatedFiles, sandboxId };
    }

    /**
     * Prepare a local workspace with packed files.
     * Does not run the agent.
     */
    private prepareLocalWorkspace(
        promptId: string,
        pack: FilePack
    ): string {
        const workspace = this.createWorkspace(promptId);
        this.writeWorkspaceFiles(workspace, pack.files);
        return workspace;
    }

    /**
     * Collect diffs and updated files from a local workspace.
     * Does not write to the project root.
     */
    private collectLocalOutcome(
        workspace: string,
        pack: FilePack,
        evaluation: EvaluationResult
    ): ExecutionOutcome {
        const updated = this.readWorkspaceFiles(
            workspace,
            evaluation.affectedFiles
        );
        const changes = collectChangedFiles(pack.originals, updated);
        return { files: changes, updatedFiles: updated };
    }

    /**
     * Run the Modal execution flow and emit stage events.
     * Does not apply changes to the project root.
     */
    private async *runModalFlow(
        prompt: PromptEntry,
        evaluation: EvaluationResult,
        pack: FilePack
    ): AsyncGenerator<ExecutionEvent, ExecutionOutcome> {
        yield { type: "stage", stage: "Spawning sandbox..." };
        const sandboxId = await this.createModalSandbox(
            prompt,
            evaluation,
            pack
        );
        yield { type: "stage", stage: "Agent is working..." };
        await this.runAgentInModal(prompt.promptId, sandboxId);
        yield { type: "stage", stage: "Extracting changes..." };
        return await this.collectModalOutcome(sandboxId, evaluation, pack);
    }

    /**
     * Run the local execution flow and emit stage events.
     * Cleans up the workspace before returning.
     */
    private async *runLocalFlow(
        prompt: PromptEntry,
        evaluation: EvaluationResult,
        pack: FilePack
    ): AsyncGenerator<ExecutionEvent, ExecutionOutcome> {
        yield { type: "stage", stage: "Spawning sandbox..." };
        const workspace = this.prepareLocalWorkspace(
            prompt.promptId,
            pack
        );
        try {
            yield { type: "stage", stage: "Agent is working..." };
            await this.runAgentLocally(prompt, evaluation, workspace);
            yield { type: "stage", stage: "Extracting changes..." };
            return this.collectLocalOutcome(workspace, pack, evaluation);
        } finally {
            this.cleanupWorkspace(workspace);
            this.log(prompt.promptId, "local", "local workspace cleaned");
        }
    }

    /**
     * Run the configured agent command inside a Modal sandbox.
     * Throws if the agent exits non-zero.
     */
    private async runAgentInModal(
        promptId: string,
        sandboxId: string
    ): Promise<void> {
        const mode = "modal";
        this.log(promptId, mode, "running agent command");

        const command = buildAgentCommand();
        let exitCode: string | null = null;

        for await (const event of this.modalClient.execStream(
            sandboxId,
            command
        )) {
            if (event.type === "exit") {
                exitCode = event.data;
            }
        }

        if (exitCode !== "0") {
            throw new Error(`Agent exited with code ${exitCode ?? "?"}`);
        }
    }

    /**
     * Create a local workspace directory for execution.
     * Removes any existing workspace with the same promptId.
     */
    private createWorkspace(promptId: string): string {
        const base = path.join(this.projectRoot, LOCAL_WORK_DIR);
        ensureDir(base);
        const workspace = path.join(base, promptId);
        if (fs.existsSync(workspace)) {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
        ensureDir(workspace);
        return workspace;
    }

    /**
     * Remove a workspace directory if it exists.
     * Does not throw if the directory is missing.
     */
    private cleanupWorkspace(workspace: string): void {
        if (fs.existsSync(workspace)) {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    }

    /**
     * Write packed files into a local workspace.
     * Does not validate file contents.
     */
    private writeWorkspaceFiles(
        workspace: string,
        files: Record<string, string>
    ): void {
        for (const [relPath, content] of Object.entries(files)) {
            const absPath = safeResolve(workspace, relPath);
            ensureDir(path.dirname(absPath));
            fs.writeFileSync(absPath, content, "utf-8");
        }
    }

    /**
     * Read files from a local workspace.
     * Skips files that do not exist.
     */
    private readWorkspaceFiles(
        workspace: string,
        relPaths: string[]
    ): Record<string, string> {
        const updated: Record<string, string> = {};

        for (const relPath of relPaths) {
            const absPath = safeResolve(workspace, relPath);
            if (!fs.existsSync(absPath)) continue;
            updated[relPath] = fs.readFileSync(absPath, "utf-8");
        }

        return updated;
    }

    /**
     * Run the configured agent command locally in a workspace.
     * Throws if the agent exits non-zero.
     */
    private async runAgentLocally(
        prompt: PromptEntry,
        evaluation: EvaluationResult,
        workspace: string
    ): Promise<void> {
        const promptId = prompt.promptId;
        const mode = "local";

        await this.ensureCleanWorkingTree();

        const env = { ...process.env, ...buildAgentEnv(prompt, evaluation) };
        const command = buildAgentCommand();

        this.log(promptId, mode, "spawning local agent command");

        await new Promise<void>((resolve, reject) => {
            const child = spawn(command[0], command.slice(1), {
                cwd: workspace,
                env,
                stdio: "ignore",
            });

            child.on("error", (err) => {
                reject(new Error(`Failed to spawn agent: ${err.message}`));
            });

            child.on("exit", (code) => {
                if (code === 0) return resolve();
                reject(new Error(`Agent exited with code ${code ?? "?"}`));
            });
        });
    }

    /**
     * Ensure the local working tree is clean before apply.
     * Respects OVERMIND_ALLOW_DIRTY for bypass.
     */
    private async ensureCleanWorkingTree(): Promise<void> {
        if (process.env["OVERMIND_ALLOW_DIRTY"] === "1") {
            return;
        }

        const isDirty = await isWorkingTreeDirty(this.projectRoot);
        if (isDirty) {
            throw new Error("Working tree is dirty; refusing to apply changes");
        }
    }

    /**
     * Apply updated file contents to the local project.
     * Does not write files outside the project root.
     */
    private async applyChanges(
        updatedFiles: Record<string, string>
    ): Promise<void> {
        for (const [relPath, content] of Object.entries(updatedFiles)) {
            const absPath = safeResolve(this.projectRoot, relPath);
            ensureDir(path.dirname(absPath));
            fs.writeFileSync(absPath, content, "utf-8");
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
