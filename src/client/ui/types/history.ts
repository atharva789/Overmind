/**
 * Purpose: Define the HistoryEntry discriminated union for the
 *          scrollable chat history TUI.
 * High-level behavior: Provides type-safe entry variants that
 *          cover every event the user can see in the history view.
 * Assumptions: Each entry has a unique `id` and a `timestamp`.
 * Invariants: The `kind` field is the discriminant; every variant
 *             is exhaustively handled in rendering code.
 */

import type { FileChange } from "../../../shared/protocol.js";

// ─── Agent stream event sub-types ───

export type AgentEventType =
    | "stage"
    | "plan-ready"
    | "agent-spawned"
    | "agent-finished"
    | "tool-start"
    | "tool-result"
    | "thinking";

// ─── HistoryEntry discriminated union ───

export type HistoryEntry =
    | UserPromptEntry
    | StatusEntry
    | AgentEventEntry
    | CompletionEntry
    | ShellEntry
    | MergeEntry;

export interface UserPromptEntry {
    readonly kind: "user-prompt";
    readonly id: string;
    readonly promptId: string;
    readonly content: string;
    readonly timestamp: number;
}

export interface StatusEntry {
    readonly kind: "status";
    readonly id: string;
    readonly promptId: string;
    readonly status: string;
    readonly message: string;
    readonly timestamp: number;
}

export interface AgentEventEntry {
    readonly kind: "agent-event";
    readonly id: string;
    readonly promptId: string;
    readonly eventType: AgentEventType;
    readonly data: Readonly<Record<string, unknown>>;
    readonly timestamp: number;
}

export interface CompletionEntry {
    readonly kind: "completion";
    readonly id: string;
    readonly promptId: string;
    readonly files: readonly FileChange[];
    readonly summary: string;
    readonly timestamp: number;
}

export interface ShellEntry {
    readonly kind: "shell";
    readonly id: string;
    readonly command: string;
    readonly output: string;
    readonly timestamp: number;
}

export interface MergeEntry {
    readonly kind: "merge";
    readonly id: string;
    readonly message: string;
    readonly status: string;
    readonly timestamp: number;
}
