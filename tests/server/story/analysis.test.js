// Purpose: Validate project overview generation from root files.
// Behavior: Creates a temp project and asserts key summary fields.
// Assumptions: Tests run after build and import from dist outputs.
// Invariants: Analysis output is deterministic for fixed inputs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProjectOverview } from "../../../dist/server/story/analysis.js";

test("buildProjectOverview includes root entries and metadata", () => {
    const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "overmind-story-")
    );
    fs.mkdirSync(path.join(tempRoot, "src"));
    fs.writeFileSync(
        path.join(tempRoot, "README.md"),
        "# Sample Project\n\nOverview here.\n",
        "utf-8"
    );
    fs.writeFileSync(
        path.join(tempRoot, "context.md"),
        "## Architecture\n- Server\n## Directory Layout\n- src/\n",
        "utf-8"
    );
    fs.writeFileSync(
        path.join(tempRoot, "package.json"),
        JSON.stringify(
            { type: "module", dependencies: { ws: "1.0.0" } },
            null,
            2
        ),
        "utf-8"
    );
    fs.writeFileSync(
        path.join(tempRoot, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { target: "ES2022" } }, null, 2),
        "utf-8"
    );

    const overview = buildProjectOverview(tempRoot);
    assert.match(overview, /Sample Project/);
    assert.match(overview, /Root entries:/);
    assert.match(overview, /src\//);
    assert.match(overview, /Dependencies: ws/);
    assert.match(overview, /TypeScript target: ES2022/);
});
