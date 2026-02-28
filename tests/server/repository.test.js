// Purpose: Verify join repository validation behavior.
// Behavior: Ensures invalid and mismatched repositories are rejected.
// Assumptions: Tests run after build and import from dist outputs.
// Invariants: Validation results are deterministic for given inputs.

import test from "node:test";
import assert from "node:assert/strict";
import { validateJoinRepository } from "../../dist/server/repository.js";
import { ErrorCode } from "../../dist/shared/constants.js";

test("validateJoinRepository accepts valid github repositories", () => {
    const result = validateJoinRepository("github.com/owner/repo");
    assert.equal(result.ok, true);
    assert.equal(result.repository, "github.com/owner/repo");
});

test("validateJoinRepository rejects non-github repositories", () => {
    const result = validateJoinRepository("https://gitlab.com/owner/repo");
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, ErrorCode.REPO_INVALID);
});

test("validateJoinRepository rejects mismatched repositories", () => {
    const result = validateJoinRepository(
        "github.com/owner/repo",
        "github.com/other/repo"
    );
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, ErrorCode.REPO_MISMATCH);
});

test("validateJoinRepository accepts matching repositories", () => {
    const result = validateJoinRepository(
        "https://github.com/Owner/Repo.git",
        "github.com/owner/repo"
    );
    assert.equal(result.ok, true);
    assert.equal(result.repository, "github.com/owner/repo");
});
