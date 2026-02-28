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
export declare function summarizeChanges(changes: FileChange[]): string;
/**
 * Pause for a fixed duration.
 * Does not block the event loop.
 * Edge cases: Zero delays still yield to the scheduler.
 * Invariants: Resolves after at least the requested delay.
 */
export declare function sleep(delayMs: number): Promise<void>;
