/**
 * Purpose: Provide deterministic file-level locks for prompt execution.
 * High-level behavior: Tracks active locks and detects path overlaps.
 * Assumptions: Paths are relative to project root and normalized.
 * Invariants: A path can only be locked by one prompt at a time.
 */

import path from "node:path";

export interface FileLock {
    promptId: string;
    paths: string[];
    acquiredAt: number;
}

export interface LockResult {
    acquired: boolean;
    conflicts: FileLock[];
}

function normalizePath(inputPath: string): string {
    const normalized = path.normalize(inputPath).replace(/\\/g, "/");
    return normalized.replace(/\/+$/u, "");
}

function pathsOverlap(left: string, right: string): boolean {
    if (left === right) return true;
    const leftPrefix = left.endsWith("/") ? left : `${left}/`;
    const rightPrefix = right.endsWith("/") ? right : `${right}/`;
    return leftPrefix.startsWith(rightPrefix)
        || rightPrefix.startsWith(leftPrefix);
}

function normalizePaths(paths: string[]): string[] {
    const unique = new Set<string>();
    for (const p of paths) {
        if (!p) continue;
        unique.add(normalizePath(p));
    }
    return [...unique];
}

export class FileLockManager {
    private locks: Map<string, FileLock> = new Map();

    /**
     * Acquire all locks atomically if no conflicts exist.
     * Does not wait or retry; it is a single attempt.
     * Edge cases: Empty paths always succeed without storing a lock.
     */
    tryAcquire(promptId: string, paths: string[]): LockResult {
        const normalized = normalizePaths(paths);
        if (normalized.length === 0) {
            return { acquired: true, conflicts: [] };
        }

        const conflicts = this.getConflicts(normalized);
        if (conflicts.length > 0) {
            return { acquired: false, conflicts };
        }

        this.locks.set(promptId, {
            promptId,
            paths: normalized,
            acquiredAt: Date.now(),
        });

        return { acquired: true, conflicts: [] };
    }

    /**
     * Release all locks held by a prompt.
     * Does not validate whether the lock existed.
     */
    release(promptId: string): void {
        this.locks.delete(promptId);
    }

    /**
     * Return conflicts for the provided paths.
     * Does not mutate internal state.
     */
    getConflicts(paths: string[]): FileLock[] {
        const normalized = normalizePaths(paths);
        const conflicts: FileLock[] = [];

        for (const lock of this.locks.values()) {
            for (const requested of normalized) {
                if (lock.paths.some((p) => pathsOverlap(p, requested))) {
                    conflicts.push(lock);
                    break;
                }
            }
        }

        return conflicts;
    }

    /**
     * Return the lock for a prompt if present.
     * Does not modify internal state.
     */
    getLock(promptId: string): FileLock | undefined {
        return this.locks.get(promptId);
    }
}
