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

const BASE_URL = "https://example.com";
const STAGE_WORKING = "Agent is working...";
const STAGE_EXTRACT = "Extracting changes...";

let importCounter = 0;

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "overmind-orch-"));
}

async function importOrchestrator() {
    importCounter += 1;
    return import(
        `../../../dist/server/orchestrator/index.js?cache=${importCounter}`
    );
}

function buildJsonResponse(payload) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}

function extractRunId(init) {
    if (!init?.body) {
        throw new Error("Missing run create body");
    }
    const rawBody = typeof init.body === "string"
        ? init.body
        : init.body.toString();
    const payload = JSON.parse(rawBody);
    if (typeof payload.runId !== "string") {
        throw new Error("Missing runId in create payload");
    }
    return payload.runId;
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

async function withFakeDateNow(values, run) {
    const originalNow = Date.now;
    let index = 0;
    Date.now = () => {
        const next = values[Math.min(index, values.length - 1)];
        index += 1;
        return next;
    };
    try {
        await run();
    } finally {
        Date.now = originalNow;
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
            OVERMIND_ORCHESTRATOR_URL: BASE_URL,
            OVERMIND_ORCHESTRATOR_POLL_MS: "0",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "5000",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root);
            const events = [];
            let runId = "";
            const statusQueue = [
                { status: "running", stage: STAGE_WORKING },
                {
                    status: "completed",
                    stage: STAGE_EXTRACT,
                    files: [{ path: "foo.txt", content: "new" }],
                    summary: "ok",
                },
            ];
            let statusIndex = 0;

            await withFetchStub(async (url, init = {}) => {
                if (url === `${BASE_URL}/runs` && init.method === "POST") {
                    runId = extractRunId(init);
                    return buildJsonResponse({ runId });
                }
                if (
                    url === `${BASE_URL}/runs/${runId}`
                    && init.method === "GET"
                ) {
                    const payload = statusQueue[Math.min(
                        statusIndex,
                        statusQueue.length - 1
                    )];
                    statusIndex += 1;
                    return buildJsonResponse(payload);
                }
                throw new Error(`Unexpected request: ${url}`);
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
            OVERMIND_ORCHESTRATOR_URL: BASE_URL,
            OVERMIND_ORCHESTRATOR_POLL_MS: "0",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "5000",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root);
            const events = [];
            let runId = "";

            await withFetchStub(async (url, init = {}) => {
                if (url === `${BASE_URL}/runs` && init.method === "POST") {
                    runId = extractRunId(init);
                    return buildJsonResponse({ runId });
                }
                if (
                    url === `${BASE_URL}/runs/${runId}`
                    && init.method === "GET"
                ) {
                    return buildJsonResponse({
                        status: "completed",
                        files: [{ path: "foo.txt" }],
                    });
                }
                throw new Error(`Unexpected request: ${url}`);
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
            OVERMIND_ORCHESTRATOR_URL: BASE_URL,
            OVERMIND_ORCHESTRATOR_POLL_MS: "0",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "5000",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root);
            let runId = "";
            const statusQueue = [
                { status: "running", stage: STAGE_WORKING },
                {
                    status: "completed",
                    stage: STAGE_EXTRACT,
                    files: [
                        { path: "foo.txt", content: "new" },
                        { path: "bar.txt", content: "extra" },
                    ],
                    summary: "ok",
                },
            ];
            let statusIndex = 0;

            await withFetchStub(async (url, init = {}) => {
                if (url === `${BASE_URL}/runs` && init.method === "POST") {
                    runId = extractRunId(init);
                    return buildJsonResponse({ runId });
                }
                if (
                    url === `${BASE_URL}/runs/${runId}`
                    && init.method === "GET"
                ) {
                    const payload = statusQueue[Math.min(
                        statusIndex,
                        statusQueue.length - 1
                    )];
                    statusIndex += 1;
                    return buildJsonResponse(payload);
                }
                throw new Error(`Unexpected request: ${url}`);
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

test("orchestrator times out when run does not finish", async () => {
    const root = makeTempDir();
    const filePath = path.join(root, "foo.txt");
    fs.writeFileSync(filePath, "old", "utf-8");

    await withEnv(
        {
            OVERMIND_ORCHESTRATOR_URL: BASE_URL,
            OVERMIND_ORCHESTRATOR_POLL_MS: "0",
            OVERMIND_ORCHESTRATOR_TIMEOUT_MS: "10",
            OVERMIND_WRITE_ALLOWLIST: "",
        },
        async () => {
            const { Orchestrator } = await importOrchestrator();
            const orchestrator = new Orchestrator(root);
            const events = [];
            let runId = "";

            await withFakeDateNow([0, 20, 40], async () => {
                await withFetchStub(async (url, init = {}) => {
                    if (url === `${BASE_URL}/runs` && init.method === "POST") {
                        runId = extractRunId(init);
                        return buildJsonResponse({ runId });
                    }
                    if (
                        url === `${BASE_URL}/runs/${runId}/cancel`
                        && init.method === "POST"
                    ) {
                        return buildJsonResponse({ ok: true });
                    }
                    throw new Error(`Unexpected request: ${url}`);
                }, async () => {
                    for await (const evt of orchestrator.execute(
                        buildPrompt(),
                        buildEvaluation(["foo.txt"])
                    )) {
                        events.push(evt.type);
                    }
                });
            });

            const updated = fs.readFileSync(filePath, "utf-8");
            assert.equal(updated, "old");
            assert.ok(events.includes("error"));
        }
    );

    fs.rmSync(root, { recursive: true, force: true });
});
