/**
 * Purpose: Shared utilities for orchestrator execution.
 * High-level behavior: Provide deterministic helpers for delays and summaries.
 * Assumptions: Inputs are validated by callers.
 * Invariants: Helpers are side-effect free aside from timing.
 */

import type { FileChange } from "./result.js";

/**
 * Summarize change counts for human-readable reporting.
 * Does not include file names or content.
 * Edge cases: Empty lists return zero counts.
 * Invariants: Output is derived only from the input list.
 */
export function summarizeChanges(changes: FileChange[]): string {
    const added = changes.reduce((sum, file) => sum + file.linesAdded, 0);
    const removed = changes.reduce((sum, file) => sum + file.linesRemoved, 0);
    return `Applied ${changes.length} file(s) (+${added}/-${removed}).`;
}

/**
 * Pause for a fixed duration.
 * Does not block the event loop.
 * Edge cases: Zero delays still yield to the scheduler.
 * Invariants: Resolves after at least the requested delay.
 */
export function sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}
