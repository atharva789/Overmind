/**
 * Purpose: Validate diff utilities for execution results.
 * High-level behavior: Ensures diff counts and headers are correct.
 * Assumptions: Diff strings follow unified diff conventions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    buildFullDiff,
    countDiffLines,
} from "../../../dist/server/orchestrator/result.js";

test("buildFullDiff returns counts and diff", () => {
    const diff = buildFullDiff("foo.txt", "old", "new");
    assert.ok(diff);
    assert.equal(diff.path, "foo.txt");
    assert.equal(diff.linesAdded, 1);
    assert.equal(diff.linesRemoved, 1);
    assert.ok(diff.diff.includes("--- a/foo.txt"));
    assert.ok(diff.diff.includes("+++ b/foo.txt"));
});

test("countDiffLines ignores headers", () => {
    const diffText = [
        "--- a/foo.txt",
        "+++ b/foo.txt",
        "@@ -1,1 +1,1 @@",
        "-old",
        "+new",
    ].join("\n");

    const counts = countDiffLines(diffText);
    assert.equal(counts.linesAdded, 1);
    assert.equal(counts.linesRemoved, 1);
});
