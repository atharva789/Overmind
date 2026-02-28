import fs from "node:fs";
import path from "node:path";
import { MAX_FILE_READ_LINES, MAX_SEARCH_RESULTS, } from "../../shared/constants.js";
// ─── Ignored patterns ───
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".next", "__pycache__", ".cache"]);
function shouldIgnore(name) {
    return IGNORED_DIRS.has(name) || name.startsWith(".");
}
/**
 * Read a file or list a directory for project context.
 * Never throws — returns a descriptive string.
 */
export function readContext(args) {
    const target = path.resolve(args.path);
    try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
            return listDirectory(target);
        }
        if (stat.isFile()) {
            return readFileTruncated(target);
        }
        return `[read_context] Unsupported file type at: ${args.path}`;
    }
    catch {
        return `[read_context] Not found: ${args.path}`;
    }
}
function readFileTruncated(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        if (lines.length > MAX_FILE_READ_LINES) {
            return (lines.slice(0, MAX_FILE_READ_LINES).join("\n") +
                `\n\n[truncated at ${MAX_FILE_READ_LINES} lines, total ${lines.length}]`);
        }
        return content;
    }
    catch {
        return `[read_context] Could not read: ${filePath}`;
    }
}
function listDirectory(dirPath, depth = 0, maxDepth = 3) {
    if (depth > maxDepth)
        return "";
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const lines = [];
        let count = 0;
        for (const entry of entries) {
            if (shouldIgnore(entry.name))
                continue;
            if (count >= MAX_SEARCH_RESULTS) {
                lines.push(`${" ".repeat(depth * 2)}... (truncated)`);
                break;
            }
            const prefix = " ".repeat(depth * 2);
            if (entry.isDirectory()) {
                lines.push(`${prefix}${entry.name}/`);
                lines.push(listDirectory(path.join(dirPath, entry.name), depth + 1, maxDepth));
            }
            else {
                lines.push(`${prefix}${entry.name}`);
            }
            count++;
        }
        return lines.filter(Boolean).join("\n");
    }
    catch {
        return `[read_context] Could not list: ${dirPath}`;
    }
}
/**
 * Search for code patterns in the project using basic substring matching.
 * Never throws — returns a descriptive string.
 */
export function fetchCode(args) {
    const searchRoot = path.resolve(args.path ?? ".");
    const results = [];
    try {
        searchFiles(searchRoot, args.query, results, 0);
    }
    catch {
        return `[fetch_code] Search failed in: ${searchRoot}`;
    }
    if (results.length === 0) {
        return `[fetch_code] No results for "${args.query}"`;
    }
    return results.join("\n\n");
}
function searchFiles(dirPath, query, results, depth) {
    if (depth > 5 || results.length >= MAX_SEARCH_RESULTS)
        return;
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS)
            break;
        if (shouldIgnore(entry.name))
            continue;
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            searchFiles(fullPath, query, results, depth + 1);
        }
        else if (entry.isFile()) {
            searchFile(fullPath, query, results);
        }
    }
}
function searchFile(filePath, query, results) {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");
        const matches = [];
        for (let i = 0; i < lines.length && matches.length < 10; i++) {
            if (lines[i].includes(query)) {
                matches.push(`  L${i + 1}: ${lines[i].trimEnd()}`);
            }
        }
        if (matches.length > 0) {
            results.push(`${filePath}:\n${matches.join("\n")}`);
        }
    }
    catch {
        // Skip unreadable files
    }
}
// ─── Gemini Tool Declarations ───
import { Type } from "@google/genai";
export const TOOL_DECLARATIONS = [
    {
        name: "read_context",
        description: "Read a file (up to 500 lines) or list a directory structure. " +
            "Use this to understand the project layout and inspect specific files. " +
            "Skips node_modules, dist, and .git directories.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                path: {
                    type: Type.STRING,
                    description: "File or directory path to read, relative to project root.",
                },
            },
            required: ["path"],
        },
    },
    {
        name: "fetch_code",
        description: "Search for a text pattern across project files. " +
            "Returns matching lines with file paths and line numbers. " +
            "Skips node_modules, dist, and .git directories. Capped at 50 results.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                query: {
                    type: Type.STRING,
                    description: "Text pattern to search for.",
                },
                path: {
                    type: Type.STRING,
                    description: "Optional subdirectory to search within.",
                },
            },
            required: ["query"],
        },
    },
];
// ─── Tool dispatcher ───
export function executeTool(name, args) {
    switch (name) {
        case "read_context":
            return readContext({ path: args["path"] ?? "." });
        case "fetch_code":
            return fetchCode({ query: args["query"] ?? "", path: args["path"] });
        default:
            return `[error] Unknown tool: ${name}`;
    }
}
//# sourceMappingURL=tools.js.map