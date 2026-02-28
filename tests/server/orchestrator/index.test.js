/**
 * Purpose: Validate local orchestrator execution flow.
 * High-level behavior: Ensures local mode applies changes deterministically.
 * Assumptions: Node runtime can execute the configured agent command.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-orch-"));
    return dir;
}

test("orchestrator executes locally and applies changes", async () => {
    process.env.OVERMIND_LOCAL = "1";
    process.env.OVERMIND_ALLOW_DIRTY = "1";
    process.env.OVERMIND_AGENT_CMD = "node";
    process.env.OVERMIND_AGENT_ARGS =
        "-e require('fs').writeFileSync('foo.txt','new')";

    const { Orchestrator } = await import(
        "../../../dist/server/orchestrator/index.js"
    );

    const root = makeTempDir();
    const filePath = path.join(root, "foo.txt");
    fs.writeFileSync(filePath, "old", "utf-8");

    const prompt = {
        promptId: "p1",
        connectionId: "c1",
        username: "user",
        content: "update foo",
        scope: ["foo.txt"],
        position: 1,
    };

    const evaluation = {
        verdict: "greenlit",
        reasoning: "ok",
        conflicts: [],
        affectedFiles: ["foo.txt"],
        executionHints: {
            estimatedComplexity: "simple",
            requiresBuild: false,
            requiresTests: false,
            relatedContextFiles: [],
        },
    };

    const orchestrator = new Orchestrator(root, "http://localhost:0");
    const events = [];
    for await (const evt of orchestrator.execute(prompt, evaluation)) {
        events.push(evt.type);
    }

    const updated = fs.readFileSync(filePath, "utf-8");
    assert.equal(updated, "new");
    assert.ok(events.includes("complete"));

    fs.rmSync(root, { recursive: true, force: true });
});
