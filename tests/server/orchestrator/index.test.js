/**
 * Purpose: Validate remote orchestrator execution flow.
 * High-level behavior: Ensures responses are validated and applied.
 * Assumptions: fetch is stubbed for deterministic test responses.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

let importCounter = 0;

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-orch-"));
    return dir;
}

async function importOrchestrator() {
    importCounter += 1;
    return import(
        `../../../dist/server/orchestrator/index.js?cache=${importCounter}`
    );
}

async function withFetchStub(stub, run) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stub;
    try {
        await run();
    } finally {
        globalThis.fetch = originalFetch;
    }
}

async function withEnv(values, run) {
    const original = {};
    for (const [key, value] of Object.entries(values)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
    try {
        await run();
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

function buildPrompt() {
    return {
        promptId: "p1",
        connectionId: "c1",
        username: "user",
        content: "update foo",
        scope: ["foo.txt"],
        position: 1,
    };
}

function buildEvaluation(affectedFiles) {
    return {
        verdict: "greenlit",
        reasoning: "ok",
        conflicts: [],
        affectedFiles,
        executionHints: {
            estimatedComplexity: "simple",
            requiresBuild: false,
            requiresTests: false,
            relatedContextFiles: [],
        },
    };
}

test("orchestrator applies remote changes", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "foo.txt");
    fs.writeFileSync(filePath, "old", "utf-8");

    await withEnv(
        {
            OVERMIND_ORCHESTRATOR_URL: "https://example.com/execute",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "5000",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root, "http://localhost:0");
            const events = [];

            await withFetchStub(async () => {
                return new Response(
                    JSON.stringify({
                        success: true,
                        files: [{ path: "foo.txt", content: "new" }],
                        summary: "ok",
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }, async () => {
                for await (const evt of orchestrator.execute(
                    buildPrompt(),
                    buildEvaluation(["foo.txt"])
                )) {
                    events.push(evt.type);
                }
            });

            const updated = fs.readFileSync(filePath, "utf-8");
            assert.equal(updated, "new");
            assert.ok(events.includes("complete"));
        }
    );

    fs.rmSync(root, { recursive: true, force: true });
});

test("orchestrator rejects invalid responses", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "foo.txt");
    fs.writeFileSync(filePath, "old", "utf-8");

    await withEnv(
        {
            OVERMIND_ORCHESTRATOR_URL: "https://example.com/execute",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "5000",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root, "http://localhost:0");
            const events = [];

            await withFetchStub(async () => {
                return new Response(
                    JSON.stringify({
                        success: true,
                        files: [{ path: "foo.txt" }],
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }, async () => {
                for await (const evt of orchestrator.execute(
                    buildPrompt(),
                    buildEvaluation(["foo.txt"])
                )) {
                    events.push(evt.type);
                }
            });

            const updated = fs.readFileSync(filePath, "utf-8");
            assert.equal(updated, "old");
            assert.ok(events.includes("error"));
        }
    );

    fs.rmSync(root, { recursive: true, force: true });
});

test("orchestrator ignores out-of-allowlist files", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "foo.txt");
    const extraPath = path.join(root, "bar.txt");
    fs.writeFileSync(filePath, "old", "utf-8");

    await withEnv(
        {
            OVERMIND_ORCHESTRATOR_URL: "https://example.com/execute",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "5000",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root, "http://localhost:0");

            await withFetchStub(async () => {
                return new Response(
                    JSON.stringify({
                        success: true,
                        files: [
                            { path: "foo.txt", content: "new" },
                            { path: "bar.txt", content: "extra" },
                        ],
                        summary: "ok",
                    }),
                    {
                        status: 200,
                        headers: { "Content-Type": "application/json" },
                    }
                );
            }, async () => {
                for await (const _evt of orchestrator.execute(
                    buildPrompt(),
                    buildEvaluation(["foo.txt"])
                )) {
                    // consume events
                }
            });

            const updated = fs.readFileSync(filePath, "utf-8");
            assert.equal(updated, "new");
            assert.equal(fs.existsSync(extraPath), false);
        }
    );

    fs.rmSync(root, { recursive: true, force: true });
});
