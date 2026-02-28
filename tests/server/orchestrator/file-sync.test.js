/**
 * Purpose: Validate file packing for sandbox execution.
 * High-level behavior: Ensures required files are included and filtered.
 * Assumptions: Temporary directories are writable.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { packFiles } from "../../../dist/server/orchestrator/file-sync.js";

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "overmind-pack-"));
    return dir;
}

test("packFiles includes required files and originals", () => {
    const root = makeTempDir();
    const srcDir = path.join(root, "src");
    const nodeModulesDir = path.join(root, "node_modules");

    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    fs.writeFileSync(path.join(root, "context.md"), "ctx", "utf-8");
    fs.writeFileSync(path.join(root, "package.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(srcDir, "alpha.ts"), "export {}", "utf-8");
    fs.writeFileSync(
        path.join(nodeModulesDir, "ignored.txt"),
        "nope",
        "utf-8"
    );

    const evaluation = {
        verdict: "greenlit",
        reasoning: "test",
        conflicts: [],
        affectedFiles: ["src/alpha.ts"],
        executionHints: {
            estimatedComplexity: "simple",
            requiresBuild: false,
            requiresTests: false,
            relatedContextFiles: [],
        },
    };

    const pack = packFiles(root, evaluation, ["context.md"]);

    assert.ok(pack.files["context.md"]);
    assert.ok(pack.files["package.json"]);
    assert.ok(pack.files["tsconfig.json"]);
    assert.ok(pack.files["src/alpha.ts"]);
    assert.equal(pack.originals["src/alpha.ts"], "export {}", "utf-8");
    assert.equal(pack.files["node_modules/ignored.txt"], undefined);

    fs.rmSync(root, { recursive: true, force: true });
});
