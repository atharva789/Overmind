/**
 * Purpose: Provide deterministic file-level locks for prompt execution.
 * High-level behavior: Tracks active locks and detects path overlaps.
 * Assumptions: Paths are relative to project root and normalized.
 * Invariants: A path can only be locked by one prompt at a time.
 */
export interface FileLock {
    promptId: string;
    paths: string[];
    acquiredAt: number;
}
export interface LockResult {
    acquired: boolean;
    conflicts: FileLock[];
}
export declare class FileLockManager {
    private locks;
    /**
     * Acquire all locks atomically if no conflicts exist.
     * Does not wait or retry; it is a single attempt.
     * Edge cases: Empty paths always succeed without storing a lock.
     */
    tryAcquire(promptId: string, paths: string[]): LockResult;
    /**
     * Release all locks held by a prompt.
     * Does not validate whether the lock existed.
     */
    release(promptId: string): void;
    /**
     * Return conflicts for the provided paths.
     * Does not mutate internal state beyond pruning.
     */
    getConflicts(paths: string[]): FileLock[];
    /**
     * Return the lock for a prompt if present.
     * Does not modify internal state.
     */
    getLock(promptId: string): FileLock | undefined;
    /**
     * Remove expired locks based on LOCK_TIMEOUT_MS.
     * Does not affect active locks.
     */
    private pruneExpired;
}
