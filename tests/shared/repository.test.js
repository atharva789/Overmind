// Purpose: Verify GitHub repository normalization and git config parsing.
// Behavior: Exercises shared helpers with representative inputs.
// Assumptions: Tests run after build and import from dist outputs.
// Invariants: All expectations are deterministic and side-effect free.

import test from "node:test";
import assert from "node:assert/strict";
import {
    normalizeGithubRepository,
    selectGitRemoteUrl,
} from "../../dist/shared/repository.js";

test("normalizeGithubRepository handles https URLs", () => {
    const result = normalizeGithubRepository(
        "https://github.com/ExampleOrg/Overmind.git"
    );
    assert.equal(result, "github.com/exampleorg/overmind");
});

test("normalizeGithubRepository handles ssh URLs", () => {
    const result = normalizeGithubRepository(
        "git@github.com:ExampleOrg/Overmind.git"
    );
    assert.equal(result, "github.com/exampleorg/overmind");
});

test("normalizeGithubRepository handles direct slugs", () => {
    const result = normalizeGithubRepository("github.com/Org/Repo");
    assert.equal(result, "github.com/org/repo");
});

test("normalizeGithubRepository rejects non-github remotes", () => {
    const result = normalizeGithubRepository(
        "https://gitlab.com/exampleorg/overmind.git"
    );
    assert.equal(result, null);
});

test("selectGitRemoteUrl prefers origin when present", () => {
    const configText = [
        "[core]",
        "    repositoryformatversion = 0",
        "[remote \"upstream\"]",
        "    url = https://github.com/other/repo.git",
        "[remote \"origin\"]",
        "    url = https://github.com/example/overmind.git",
    ].join("\n");

    const result = selectGitRemoteUrl(configText);
    assert.equal(result, "https://github.com/example/overmind.git");
});

test("selectGitRemoteUrl falls back to first remote", () => {
    const configText = [
        "[remote \"upstream\"]",
        "    url = https://github.com/other/repo.git",
    ].join("\n");

    const result = selectGitRemoteUrl(configText);
    assert.equal(result, "https://github.com/other/repo.git");
});
