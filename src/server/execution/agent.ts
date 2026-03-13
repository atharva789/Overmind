import { GoogleGenAI } from "@google/genai";
import type { Part } from "@google/genai";
import fs from "node:fs";
import path from "node:path";
import type { PromptEntry } from "../party.js";
import { EXECUTION_TOOL_DECLARATIONS, WorkspaceContext, FileChange } from "./tools.js";
import { GEMINI_MODEL_DEFAULT, getProjectRoot } from "../../shared/constants.js";
import { walkFiles } from "../orchestrator/file-sync.js";

const MAX_EXECUTION_ROUNDS = 25;
const EXECUTION_TIMEOUT_MS = 120000;
const MAX_FILE_SIZE = 50000;

export interface ExecutionResult {
    success: boolean;
    files: FileChange[];
    summary: string;
}

export type LogFn = (partyCode: string, promptId: string, module: string, msg: string) => void;

function collectProjectFiles(projectRoot: string, scopeFiles?: string[]): Record<string, string> {
    const result: Record<string, string> = {};

    if (scopeFiles && scopeFiles.length > 0) {
        // Read only the files identified by scope extraction
        for (const rel of scopeFiles) {
            try {
                const content = fs.readFileSync(path.join(projectRoot, rel), "utf-8");
                if (content.length <= MAX_FILE_SIZE) {
                    result[rel] = content;
                }
            } catch { /* skip unreadable */ }
        }
    } else {
        // Fallback: walk the entire project tree
        walkFiles(projectRoot, ".", 0, (relPath) => {
            try {
                const content = fs.readFileSync(path.join(projectRoot, relPath), "utf-8");
                if (content.length <= MAX_FILE_SIZE) {
                    result[relPath] = content;
                }
            } catch { /* skip unreadable */ }
        });
    }

    return result;
}

function buildSystemPrompt(): string {
    return `You are the Overmind Execution Agent. Fulfill the user's coding request by modifying project files.

RULES:
- The user message contains ALL project files already. Do NOT call read_file or list_dir — you have everything.
- Use write_file to save changes. You MUST write the COMPLETE file content (full overwrite, not a patch).
- After writing all files, call finish_execution with a plain text summary.
- Be direct. Do not explain what you will do — just do it.`;
}

export async function executePromptChanges(
    entry: PromptEntry,
    partyCode: string,
    log: LogFn
): Promise<ExecutionResult> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        return { success: false, files: [], summary: "Execution failed: No Gemini API Key defined." };
    }

    const modelName = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;
    const ai = new GoogleGenAI({ apiKey });

    const projectRoot = getProjectRoot();
    const projectFiles = collectProjectFiles(projectRoot, entry.scope);
    const fileContents = Object.entries(projectFiles)
        .map(([p, c]) => `=== ${p} ===\n${c}`)
        .join("\n\n");

    const systemPrompt = buildSystemPrompt();
    const userMessage = `User Request:\n"${entry.content}"\n\nScope hint: ${entry.scope?.join(", ") ?? "unscoped"}\n\n--- PROJECT FILES ---\n${fileContents}`;

    const context = new WorkspaceContext(projectRoot);

    try {
        const chat = ai.chats.create({
            model: modelName,
            config: {
                systemInstruction: systemPrompt,
                tools: [{ functionDeclarations: EXECUTION_TOOL_DECLARATIONS }],
            },
        });

        let response = await withTimeout(
            chat.sendMessage({ message: userMessage }),
            EXECUTION_TIMEOUT_MS
        );
        let summaryText = "";

        for (let round = 0; round < MAX_EXECUTION_ROUNDS; round++) {
            const functionCalls = response.functionCalls;

            if (!functionCalls || functionCalls.length === 0) {
                // If model just replies with text, we consider it done.
                summaryText = response.text ?? "";
                break;
            }

            let finished = false;
            const functionResponseParts: Part[] = functionCalls.map((fc) => {
                const args = (fc.args ?? {}) as Record<string, string>;

                log(partyCode, entry.promptId, "execution", `tool:${fc.name ?? ""}(...)`);

                if (fc.name === "finish_execution") {
                    finished = true;
                    summaryText = args["summary"] ?? "Execution finished.";
                    return {
                        functionResponse: { name: fc.name, response: { result: "OK" } }
                    };
                }

                const res = context.executeTool(fc.name ?? "", args);

                return {
                    functionResponse: {
                        name: fc.name ?? "",
                        // Convert errors to string result so Gemini sees them
                        response: { result: res.success ? (res.result || "OK") : (res.error || "Error") },
                    },
                };
            });

            if (finished) break;

            response = await withTimeout(
                chat.sendMessage({ message: functionResponseParts }),
                EXECUTION_TIMEOUT_MS
            );
        }

        if (!summaryText) {
            summaryText = "Execution completed implicitly.";
        }

        // Aggregate file changes based on context's captured diffs
        const uniqueChanges = new Map<string, FileChange>();
        for (const change of context.changes) {
            uniqueChanges.set(change.path, change);
        }

        return {
            success: true,
            files: Array.from(uniqueChanges.values()),
            summary: summaryText
        };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(partyCode, entry.promptId, "execution", `error: ${msg}`);
        return { success: false, files: [], summary: `Execution failed: ${msg}` };
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
    ]);
}
