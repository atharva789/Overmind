import fs from "node:fs";
import path from "node:path";
import { autoGreenlit } from "./evaluate.js";
import { detectScopeOverlap } from "./conflict.js";
import { readContext } from "./tools.js";
import { evaluateWithGemini } from "./backends/gemini.js";
import { evaluateWithGlmModal } from "./backends/glm_modal.js";
import { GREENLIGHT_BACKEND_DEFAULT, LOG_TRUNCATE_CHARS, MAX_CONTEXT_PAYLOAD_CHARS, } from "../../shared/constants.js";
// ─── Logging ───
const LOG_FILE = "greenlight.log";
export function greenlightLog(partyCode, promptId, backend, message) {
    const ts = new Date().toISOString();
    const truncated = message.length > LOG_TRUNCATE_CHARS
        ? message.slice(0, LOG_TRUNCATE_CHARS) + "…"
        : message;
    const line = `[${ts}] [${partyCode}] [${promptId}] [${backend}] ${truncated}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line);
    }
    catch {
        // Ignore write errors — logging should never crash the server
    }
}
// ─── Backend selection ───
function getBackend() {
    const env = process.env["OVERMIND_GREENLIGHT_BACKEND"] ?? GREENLIGHT_BACKEND_DEFAULT;
    if (env === "gemini")
        return "gemini";
    return "glm";
}
// ─── Main evaluation entry point ───
/**
 * Evaluate a prompt using the configured backend.
 * Fallback chain: GLM Modal → Gemini → auto-greenlit.
 */
export async function evaluatePrompt(entry, concurrent, partyCode) {
    // 1. Run local conflict detection
    const overlapHint = detectScopeOverlap(entry, concurrent);
    const backend = getBackend();
    greenlightLog(partyCode, entry.promptId, backend, `evaluating (prompt length: ${entry.content.length}, scope: ${entry.scope?.join(",") ?? "none"}, concurrent: ${concurrent.length})`);
    // 2. Try primary backend
    if (backend === "glm") {
        try {
            const req = buildGlmRequest(entry, concurrent, overlapHint);
            const result = await evaluateWithGlmModal(req, partyCode, entry.promptId, greenlightLog);
            greenlightLog(partyCode, entry.promptId, "glm", `verdict: ${result.verdict}`);
            return result;
        }
        catch {
            greenlightLog(partyCode, entry.promptId, "glm", "GLM failed, attempting Gemini fallback");
            // Fallback to Gemini if API key exists
            if (process.env["GEMINI_API_KEY"]) {
                const result = await evaluateWithGemini(entry.content, entry.scope, overlapHint, partyCode, entry.promptId, greenlightLog);
                greenlightLog(partyCode, entry.promptId, "gemini-fallback", `verdict: ${result.verdict}`);
                return result;
            }
            greenlightLog(partyCode, entry.promptId, "auto", "both backends unavailable");
            return autoGreenlit("Both GLM and Gemini unavailable — auto-approved.");
        }
    }
    // 3. Direct Gemini backend
    const result = await evaluateWithGemini(entry.content, entry.scope, overlapHint, partyCode, entry.promptId, greenlightLog);
    greenlightLog(partyCode, entry.promptId, "gemini", `verdict: ${result.verdict}`);
    return result;
}
// ─── GLM Context Bundle Builder ───
function buildGlmRequest(entry, concurrent, overlapHint) {
    // Gather project context locally (since GLM can't call tools)
    const rootContext = readRootContext();
    const relatedContextFiles = findRelatedContextFiles(entry.scope);
    const codeSnippets = gatherCodeSnippets(entry.scope);
    const fileListing = readContext({ path: "." });
    // Truncate the total payload
    const truncatedListing = truncateField(fileListing, 3000);
    return {
        prompt: {
            promptId: entry.promptId,
            content: entry.content,
            scope: entry.scope,
        },
        concurrent: concurrent.map((p) => ({
            promptId: p.promptId,
            scope: p.scope,
            // Never include other users' prompt content
        })),
        overlapHint: {
            overlaps: overlapHint.overlaps,
            conflictPromptIds: overlapHint.conflictPromptIds,
            notes: overlapHint.notes,
        },
        projectContext: {
            rootContext,
            relatedContextFiles,
            codeSnippets,
            fileListing: truncatedListing,
        },
        constraints: {
            mustNotLeakPromptContent: true,
            jsonOnly: true,
        },
    };
}
function readRootContext() {
    const candidates = ["context.md", "CONTEXT.md", "README.md"];
    for (const name of candidates) {
        try {
            const content = fs.readFileSync(name, "utf-8");
            return truncateField(content, 5000);
        }
        catch {
            continue;
        }
    }
    return "No context file found (context.md / README.md).";
}
function findRelatedContextFiles(scope) {
    const results = [];
    if (!scope)
        return results;
    let totalChars = 0;
    for (const s of scope) {
        if (totalChars > MAX_CONTEXT_PAYLOAD_CHARS / 2)
            break;
        // Try to find context files near the scope paths
        const dir = path.dirname(s);
        const contextFile = path.join(dir, "context.md");
        try {
            const content = fs.readFileSync(contextFile, "utf-8");
            const truncated = truncateField(content, 2000);
            results.push({ path: contextFile, content: truncated });
            totalChars += truncated.length;
        }
        catch {
            // No context file at this path
        }
    }
    return results;
}
function gatherCodeSnippets(scope) {
    const results = [];
    if (!scope)
        return results;
    let totalChars = 0;
    for (const s of scope) {
        if (totalChars > MAX_CONTEXT_PAYLOAD_CHARS / 2)
            break;
        try {
            const stat = fs.statSync(s);
            if (stat.isFile()) {
                const content = fs.readFileSync(s, "utf-8");
                const truncated = truncateField(content, 3000);
                results.push({
                    path: s,
                    content: truncated,
                    note: content.length > 3000 ? "truncated" : undefined,
                });
                totalChars += truncated.length;
            }
        }
        catch {
            // File doesn't exist or not readable
        }
    }
    return results;
}
function truncateField(value, maxLen) {
    if (value.length <= maxLen)
        return value;
    return value.slice(0, maxLen) + `\n[truncated at ${maxLen} chars]`;
}
//# sourceMappingURL=agent.js.map