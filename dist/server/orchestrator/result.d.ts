/**
 * Purpose: Normalize and generate file diffs for execution results.
 * High-level behavior: Computes line counts and builds unified diffs.
 * Assumptions: Inputs are UTF-8 file contents, paths are relative.
 * Invariants: linesAdded/linesRemoved reflect the diff payload.
 */
export interface FileChange {
    path: string;
    diff: string;
    linesAdded: number;
    linesRemoved: number;
}
/**
 * Count added/removed lines in a unified diff string.
 * Ignores diff metadata lines (---, +++).
 */
export declare function countDiffLines(diff: string): {
    linesAdded: number;
    linesRemoved: number;
};
/**
 * Build a full-file unified diff (replace all lines).
 * Does not attempt a minimal diff; it is deterministic.
 */
export declare function buildFullDiff(relPath: string, before: string, after: string): FileChange | null;
/**
 * Normalize changes that only include path+diff into full FileChange.
 * Preserves the diff payload while recomputing line counts.
 */
export declare function normalizeDiffChanges(changes: Array<{
    path: string;
    diff: string;
}>): FileChange[];
