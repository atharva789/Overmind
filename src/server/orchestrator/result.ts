/**
 * result.ts — Execution result types and diff-related utilities.
 *
 * Purpose:
 *   Defines the types used throughout the orchestrator for execution
 *   events, agent execution state, sandbox configuration, and file
 *   changes. Also re-exports FileChange from protocol.
 *
 * Assumptions:
 *   - All execution flows produce a stream of ExecutionEvents.
 *   - AgentExecution tracks the lifecycle of a single prompt execution.
 *
 * Invariants:
 *   - ExecutionEvent is a discriminated union on the "type" field.
 *   - sandboxId is our internal ID, not Modal's object_id.
 */

import type { FileChange } from "../../shared/protocol.js";

// ─── Sandbox Configuration ───

export interface SandboxConfig {
    /** Image name: "base" or "build". */
    image: string;
    /** Files to upload: path -> content. */
    files: Record<string, string>;
    /** Environment variables for the sandbox. */
    env: Record<string, string>;
    /** Sandbox timeout in seconds. */
    timeoutSeconds: number;
    /** Optional tags for filtering/debugging. */
    tags?: Record<string, string>;
}

// ─── Execution Events ───

export type ExecutionEvent =
    | { type: "stage"; stage: string; detail?: string }
    | { type: "agent-output"; content: string }
    | { type: "files-changed"; files: FileChange[] }
    | {
        type: "complete";
        result: ExecutionResult;
    }
    | { type: "error"; message: string; recoverable: boolean };

export interface ExecutionResult {
    promptId: string;
    files: FileChange[];
    summary: string;
    sandboxId: string;
}

// ─── Agent Execution State ───

export interface AgentExecution {
    promptId: string;
    sandboxId: string;
    username: string;
    startedAt: number;
    status: "running" | "completed" | "failed" | "cancelled";
}

// ─── Stream Event (from bridge SSE) ───

export interface StreamEvent {
    type: "stdout" | "stderr" | "exit";
    data: string;
}
