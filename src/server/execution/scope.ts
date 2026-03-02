import { GoogleGenAI, Type } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import { GEMINI_MODEL_DEFAULT } from "../../shared/constants.js";

const MAX_WALK_DEPTH = 5;
const MAX_AFFECTED_FILES = 15;

const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    ".overmind",
    "modal-bridge",
]);

const scopeSchema = {
    type: Type.OBJECT,
    description: "Identify which files in the project are likely affected by the user's prompt.",
    properties: {
        affectedFiles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: `Relative file paths the agent will need to read or modify to fulfill the prompt. Include files that need changes AND files that provide essential context (imports, types, related modules). Max ${MAX_AFFECTED_FILES} files. Use exact paths from the listing.`,
        },
        complexity: {
            type: Type.STRING,
            enum: ["simple", "moderate", "complex"],
            description: "Estimated complexity: 'simple' for single-file changes, 'moderate' for 2-5 files, 'complex' for broad refactoring or architectural changes.",
        },
    },
    required: ["affectedFiles", "complexity"],
};

export interface ScopeResult {
    affectedFiles: string[];
    complexity: "simple" | "moderate" | "complex";
}

function walkProjectTree(root: string, relative: string, depth: number, result: string[]): void {
    if (depth > MAX_WALK_DEPTH) return;
    let entries;
    try {
        entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) continue;
            const rel = path.join(relative, entry.name).replace(/\\/g, "/");
            walkProjectTree(root, rel, depth + 1, result);
        } else if (entry.isFile()) {
            const rel = path.join(relative, entry.name).replace(/\\/g, "/");
            result.push(rel);
        }
    }
}

export async function extractScope(prompt: string, projectRoot: string): Promise<ScopeResult> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        console.log("[scope] Skipping: GEMINI_API_KEY not set");
        return { affectedFiles: [], complexity: "simple" };
    }

    try {
        const filePaths: string[] = [];
        walkProjectTree(projectRoot, ".", 0, filePaths);
        const listing = filePaths.join("\n");

        const ai = new GoogleGenAI({ apiKey });
        const model = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;

        const response = await ai.models.generateContent({
            model,
            contents: `You are analyzing a software project to determine which files are relevant to a user's coding request.

Project file tree:
${listing}

User prompt:
"${prompt}"

Identify the files that will need to be read or modified to fulfill this prompt. Include:
- Files that need direct changes
- Files that provide essential context (imports, type definitions, related modules)
- Test files if the change affects tested code

Return exact paths from the file tree above. Do not invent paths.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: scopeSchema,
                temperature: 0.0,
            },
        });

        const raw = response.text;
        if (!raw) {
            console.log("[scope] Empty response from Gemini");
            return { affectedFiles: [], complexity: "simple" };
        }

        const parsed = JSON.parse(raw);
        const fileSet = new Set(filePaths);
        const validFiles = (parsed.affectedFiles as string[])
            .filter((f: string) => fileSet.has(f))
            .slice(0, MAX_AFFECTED_FILES);

        const complexity = ["simple", "moderate", "complex"].includes(parsed.complexity)
            ? parsed.complexity as ScopeResult["complexity"]
            : "simple";

        console.log(`[scope] Extracted ${validFiles.length} affected files (${complexity}): ${validFiles.join(", ")}`);
        return { affectedFiles: validFiles, complexity };
    } catch (err: any) {
        if (err?.status === 429) {
            console.log("[scope] Skipped: Gemini API rate limit (429)");
        } else {
            console.error("[scope] Error extracting scope:", err?.message || err);
        }
        return { affectedFiles: [], complexity: "simple" };
    }
}
