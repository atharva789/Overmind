import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { Type } from "@google/genai";
export const EXECUTION_TOOL_DECLARATIONS = [
    {
        name: "read_file",
        description: "Read the contents of a file",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "Path to the file relative to project root" }
            },
            required: ["path"]
        }
    },
    {
        name: "write_file",
        description: "Write content to a file. Overwrites the file completely.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "Path to the file relative to project root" },
                content: { type: Type.STRING, description: "The complete new content to write to the file" }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "list_dir",
        description: "List the contents of a directory",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: { type: Type.STRING, description: "Path to the directory relative to project root (e.g. '.')" }
            },
            required: ["path"]
        }
    },
    {
        name: "finish_execution",
        description: "Call this when you have successfully completed the user's prompt",
        parameters: {
            type: Type.OBJECT,
            properties: {
                summary: { type: Type.STRING, description: "A summary of what you did" }
            },
            required: ["summary"]
        }
    }
];
// Global state for tracked changes during an execution session
export class WorkspaceContext {
    changes = [];
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot ?? process.cwd();
    }
    executeTool(name, args) {
        try {
            const cwd = this.projectRoot;
            switch (name) {
                case "read_file": {
                    const p = path.resolve(cwd, args.path);
                    if (!p.startsWith(cwd))
                        throw new Error("Access denied");
                    return { success: true, result: fs.readFileSync(p, "utf-8") };
                }
                case "write_file": {
                    const p = path.resolve(cwd, args.path);
                    if (!p.startsWith(cwd))
                        throw new Error("Access denied");
                    let oldContent = "";
                    if (fs.existsSync(p)) {
                        oldContent = fs.readFileSync(p, "utf-8");
                    }
                    fs.mkdirSync(path.dirname(p), { recursive: true });
                    fs.writeFileSync(p, args.content, "utf-8");
                    // Compute diff
                    let diffText = "";
                    const tmpOld = path.join(os.tmpdir(), "old_" + Date.now() + Math.random().toString().slice(2));
                    const tmpNew = path.join(os.tmpdir(), "new_" + Date.now() + Math.random().toString().slice(2));
                    fs.writeFileSync(tmpOld, oldContent);
                    fs.writeFileSync(tmpNew, args.content);
                    try {
                        execSync(`diff -u ${tmpOld} ${tmpNew}`);
                    }
                    catch (err) {
                        diffText = err.stdout?.toString() ?? "";
                        diffText = diffText.replace(new RegExp(`--- ${tmpOld}.*`), `--- a/${args.path}`);
                        diffText = diffText.replace(new RegExp(`\\+\\+\\+ ${tmpNew}.*`), `+++ b/${args.path}`);
                    }
                    finally {
                        if (fs.existsSync(tmpOld))
                            fs.unlinkSync(tmpOld);
                        if (fs.existsSync(tmpNew))
                            fs.unlinkSync(tmpNew);
                    }
                    if (diffText) {
                        const linesAdded = (diffText.match(/^\+([^+]|$)/gm) || []).length;
                        const linesRemoved = (diffText.match(/^-([^-]|$)/gm) || []).length;
                        this.changes.push({
                            path: args.path,
                            diff: diffText,
                            linesAdded,
                            linesRemoved
                        });
                    }
                    return { success: true, result: `Successfully wrote to ${args.path}` };
                }
                case "list_dir": {
                    const p = path.resolve(cwd, args.path);
                    if (!p.startsWith(cwd))
                        throw new Error("Access denied");
                    const items = fs.readdirSync(p, { withFileTypes: true });
                    const lines = items.map(item => `${item.isDirectory() ? '[DIR] ' : '[FILE]'} ${item.name}`);
                    return { success: true, result: lines.join("\n") };
                }
                case "finish_execution": {
                    return { success: true, result: "Execution finished." };
                }
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
}
//# sourceMappingURL=tools.js.map