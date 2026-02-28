/**
 * Purpose: Validate FileLockManager conflict behavior.
 * High-level behavior: Ensures locks are acquired and released
 * deterministically.
 * Assumptions: Paths are normalized before comparison.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    FileLockManager,
} from "../../../dist/server/orchestrator/file-lock.js";

test("acquires locks without conflicts", () => {
    const manager = new FileLockManager();
    const result = manager.tryAcquire("p1", ["src/index.ts"]);
    assert.equal(result.acquired, true);
    assert.equal(result.conflicts.length, 0);
});

test("detects overlapping path conflicts", () => {
    const manager = new FileLockManager();
    manager.tryAcquire("p1", ["src/index.ts"]);

    const conflict = manager.tryAcquire("p2", ["src"]);
    assert.equal(conflict.acquired, false);
    assert.equal(conflict.conflicts.length, 1);
    assert.equal(conflict.conflicts[0].promptId, "p1");
});

test("releases locks", () => {
    const manager = new FileLockManager();
    manager.tryAcquire("p1", ["src/index.ts"]);
    manager.release("p1");

    const retry = manager.tryAcquire("p2", ["src/index.ts"]);
    assert.equal(retry.acquired, true);
});
