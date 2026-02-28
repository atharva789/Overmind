/**
 * file-lock.ts — File-level locking for concurrent agent execution.
 *
 * Purpose:
 *   Prevents two concurrent agents from modifying the same file.
 *   Locks are local and in-memory since all orchestration flows
 *   through a single Overmind server process.
 *
 * Assumptions:
 *   - Lock acquisition is all-or-nothing (atomic).
 *   - Remote agents take longer, so timeout is 5 minutes.
 *   - Locks are keyed by promptId, not sandboxId.
 *
 * Invariants:
 *   - A file can be locked by at most one promptId at a time.
 *   - Timed-out locks are automatically released on next check.
 *   - release() is idempotent — safe to call multiple times.
 */

import { LOCK_TIMEOUT_MS } from "../../shared/constants.js";

// ─── Types ───

export interface FileLock {
    promptId: string;
    path: string;
    acquiredAt: number;
}

export interface LockResult {
    acquired: boolean;
    conflicts: FileLock[];
}

// ─── FileLockManager ───

export class FileLockManager {
    private locks: Map<string, FileLock> = new Map();

    /**
     * Attempt to acquire locks for all specified paths atomically.
     *
     * If any path is already locked by a different promptId (and
     * the lock hasn't timed out), returns { acquired: false } with
     * the conflicting locks. Otherwise acquires all and returns
     * { acquired: true }.
     *
     * Does NOT retry — caller must implement wait logic.
     */
    tryAcquire(promptId: string, paths: string[]): LockResult {
        this.pruneExpired();

        const conflicts: FileLock[] = [];
        for (const path of paths) {
            const existing = this.locks.get(path);
            if (existing && existing.promptId !== promptId) {
                conflicts.push(existing);
            }
        }

        if (conflicts.length > 0) {
            return { acquired: false, conflicts };
        }

        const now = Date.now();
        for (const path of paths) {
            this.locks.set(path, { promptId, path, acquiredAt: now });
        }

        return { acquired: true, conflicts: [] };
    }

    /**
     * Release all locks held by a given promptId.
     * Idempotent — safe to call even if no locks are held.
     */
    release(promptId: string): void {
        for (const [path, lock] of this.locks) {
            if (lock.promptId === promptId) {
                this.locks.delete(path);
            }
        }
    }

    /**
     * Check which files in the given list are currently locked
     * by other promptIds. Does NOT acquire any locks.
     */
    getConflicts(paths: string[]): FileLock[] {
        this.pruneExpired();
        const conflicts: FileLock[] = [];
        for (const path of paths) {
            const existing = this.locks.get(path);
            if (existing) {
                conflicts.push(existing);
            }
        }
        return conflicts;
    }

    /**
     * Remove locks that have exceeded LOCK_TIMEOUT_MS.
     * Called automatically before acquire/conflict checks.
     */
    private pruneExpired(): void {
        const now = Date.now();
        for (const [path, lock] of this.locks) {
            if (now - lock.acquiredAt > LOCK_TIMEOUT_MS) {
                this.locks.delete(path);
            }
        }
    }
}
