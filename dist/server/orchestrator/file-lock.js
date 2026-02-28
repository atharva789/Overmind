/**
 * Purpose: Provide deterministic file-level locks for prompt execution.
 * High-level behavior: Tracks active locks and detects path overlaps.
 * Assumptions: Paths are relative to project root and normalized.
 * Invariants: A path can only be locked by one prompt at a time.
 */
import path from "node:path";
import { LOCK_TIMEOUT_MS } from "../../shared/constants.js";
/**
 * Normalize paths for overlap checks and stable comparisons.
 * Does not validate filesystem existence.
 */
function normalizePath(inputPath) {
    const normalized = path.normalize(inputPath).replace(/\\/g, "/");
    return normalized.replace(/\/+$/u, "");
}
/**
 * Detect whether two normalized paths overlap by prefix.
 * Does not resolve symlinks or check filesystem state.
 */
function pathsOverlap(left, right) {
    if (left === right)
        return true;
    const leftPrefix = left.endsWith("/") ? left : `${left}/`;
    const rightPrefix = right.endsWith("/") ? right : `${right}/`;
    return leftPrefix.startsWith(rightPrefix)
        || rightPrefix.startsWith(leftPrefix);
}
/**
 * Normalize and de-duplicate a path list.
 * Does not sort output to preserve insertion order.
 */
function normalizePaths(paths) {
    const unique = new Set();
    for (const entry of paths) {
        if (!entry)
            continue;
        unique.add(normalizePath(entry));
    }
    return [...unique];
}
/**
 * Determine if a lock has exceeded its timeout.
 * Does not mutate the lock or update timestamps.
 */
function isLockExpired(lock, now) {
    return now - lock.acquiredAt > LOCK_TIMEOUT_MS;
}
export class FileLockManager {
    locks = new Map();
    /**
     * Acquire all locks atomically if no conflicts exist.
     * Does not wait or retry; it is a single attempt.
     * Edge cases: Empty paths always succeed without storing a lock.
     */
    tryAcquire(promptId, paths) {
        this.pruneExpired();
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
    release(promptId) {
        this.locks.delete(promptId);
    }
    /**
     * Return conflicts for the provided paths.
     * Does not mutate internal state beyond pruning.
     */
    getConflicts(paths) {
        this.pruneExpired();
        const normalized = normalizePaths(paths);
        const conflicts = [];
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
    getLock(promptId) {
        return this.locks.get(promptId);
    }
    /**
     * Remove expired locks based on LOCK_TIMEOUT_MS.
     * Does not affect active locks.
     */
    pruneExpired() {
        const now = Date.now();
        for (const [promptId, lock] of this.locks) {
            if (isLockExpired(lock, now)) {
                this.locks.delete(promptId);
            }
        }
    }
}
//# sourceMappingURL=file-lock.js.map