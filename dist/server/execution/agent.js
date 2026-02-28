import { GoogleGenAI } from "@google/genai";
import { EXECUTION_TOOL_DECLARATIONS, WorkspaceContext } from "./tools.js";
import { GEMINI_MODEL_DEFAULT } from "../../shared/constants.js";
// Hardcoded larger limit for execution tasks
const MAX_EXECUTION_ROUNDS = 10;
const EXECUTION_TIMEOUT_MS = 60000;
function buildSystemPrompt() {
    return `You are the Overmind Execution Agent. Your job is to fulfill the user's coding request by modifying files in the current project directory.
    
1. You have tools to \`read_file\`, \`write_file\`, and \`list_dir\`.
2. First, use \`list_dir\` and \`read_file\` to understand the context and locate where changes should be made.
3. Once you know what to do, use \`write_file\` to save your changes. If you are modifying an existing file, you MUST overwrite it completely with the full new content (no partial patching).
4. After applying all changes, call \`finish_execution\` with a short summary of what you did.

If you cannot fulfill the prompt due to missing context or errors, call \`finish_execution\` explaining why it failed. Do NOT wrap your summary in markdown. Return plain text summaries.`;
}
export async function executePromptChanges(entry, partyCode, log) {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        return { success: false, files: [], summary: "Execution failed: No Gemini API Key defined." };
    }
    const modelName = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;
    const ai = new GoogleGenAI({ apiKey });
    const systemPrompt = buildSystemPrompt();
    const userMessage = `User Request:\n"${entry.content}"\n\nScope hint: ${entry.scope?.join(", ") ?? "unscoped"}`;
    const context = new WorkspaceContext();
    try {
        const chat = ai.chats.create({
            model: modelName,
            config: {
                systemInstruction: systemPrompt,
                tools: [{ functionDeclarations: EXECUTION_TOOL_DECLARATIONS }],
            },
        });
        let response = await withTimeout(chat.sendMessage({ message: userMessage }), EXECUTION_TIMEOUT_MS);
        let summaryText = "";
        for (let round = 0; round < MAX_EXECUTION_ROUNDS; round++) {
            const functionCalls = response.functionCalls;
            if (!functionCalls || functionCalls.length === 0) {
                // If model just replies with text, we consider it done.
                summaryText = response.text ?? "";
                break;
            }
            let finished = false;
            const functionResponseParts = functionCalls.map((fc) => {
                const args = (fc.args ?? {});
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
            if (finished)
                break;
            response = await withTimeout(chat.sendMessage({ message: functionResponseParts }), EXECUTION_TIMEOUT_MS);
        }
        if (!summaryText) {
            summaryText = "Execution completed implicitly.";
        }
        // Aggregate file changes based on context's captured diffs
        const uniqueChanges = new Map();
        for (const change of context.changes) {
            uniqueChanges.set(change.path, change);
        }
        return {
            success: true,
            files: Array.from(uniqueChanges.values()),
            summary: summaryText
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(partyCode, entry.promptId, "execution", `error: ${msg}`);
        return { success: false, files: [], summary: `Execution failed: ${msg}` };
    }
}
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
    ]);
}
//# sourceMappingURL=agent.js.map