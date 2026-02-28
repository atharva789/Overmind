import { GoogleGenerativeAI } from "@google/generative-ai";
import type { EvaluationResult } from "../evaluate.js";
import { autoGreenlit, validateResult } from "../evaluate.js";
import { executeTool, TOOL_DECLARATIONS } from "../tools.js";
import {
    GEMINI_MODEL_DEFAULT,
    MAX_TOOL_ROUNDS,
    EVAL_TIMEOUT_MS,
} from "../../../shared/constants.js";
import type { OverlapResult } from "../conflict.js";

export type LogFn = (partyCode: string, promptId: string, backend: string, msg: string) => void;

// ─── System prompt ───

function buildSystemPrompt(overlapHint: OverlapResult): string {
    return `You are the Overmind Greenlight Agent. You evaluate coding prompts for safety and conflicts.

Your job:
1. Use the read_context and fetch_code tools to inspect the project.
2. Decide whether the prompt should be GREENLIT (safe to execute) or REDLIT (conflicts or violations).

Decision policy:
- GREENLIT if in doubt.
- REDLIT only for:
  - Architectural mismatch (e.g., rewriting in a different language, massive rewrites)
  - Strong overlap with concurrent prompt scopes
  - Unclear scope that touches broad areas dangerously
- Reasoning must be 1-3 sentences.

${overlapHint.overlaps ? `⚠ Scope overlap detected: ${overlapHint.notes}` : "No scope conflicts detected."}

You MUST respond with ONLY a JSON object matching this schema:
{
  "verdict": "greenlit" | "redlit",
  "reasoning": "string",
  "conflicts": ["string"],
  "affectedFiles": ["string"],
  "executionHints": {
    "estimatedComplexity": "simple" | "moderate" | "complex",
    "requiresBuild": boolean,
    "requiresTests": boolean,
    "relatedContextFiles": ["string"]
  }
}

Do NOT wrap in markdown. Return ONLY valid JSON.`;
}

// ─── Gemini backend ───

export async function evaluateWithGemini(
    promptContent: string,
    promptScope: string[] | undefined,
    overlapHint: OverlapResult,
    partyCode: string,
    promptId: string,
    log: LogFn
): Promise<EvaluationResult> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        return autoGreenlit("Gemini API key not configured.");
    }

    const modelName = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
        model: modelName,
        tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    });

    const systemPrompt = buildSystemPrompt(overlapHint);
    const userMessage = `Evaluate this prompt:\n\n"${promptContent}"\n\nScope: ${promptScope?.join(", ") ?? "unscoped"}`;

    const toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }> = [];

    try {
        const chat = model.startChat({
            systemInstruction: systemPrompt,
        });

        let response = await withTimeout(
            chat.sendMessage(userMessage),
            EVAL_TIMEOUT_MS
        );

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const candidate = response.response.candidates?.[0];
            if (!candidate) break;

            const parts = candidate.content?.parts ?? [];
            const functionCalls = parts.filter((p) => p.functionCall);

            if (functionCalls.length === 0) {
                const text = response.response.text();
                return parseGeminiResponse(text, toolCalls, partyCode, promptId, log);
            }

            const toolResults = functionCalls.map((part) => {
                const fc = part.functionCall!;
                const args = (fc.args ?? {}) as Record<string, string>;
                const result = executeTool(fc.name, args);
                toolCalls.push({ tool: fc.name, args, result: result.slice(0, 500) });
                log(partyCode, promptId, "gemini", `tool:${fc.name}(${JSON.stringify(args)})`);
                return {
                    functionResponse: {
                        name: fc.name,
                        response: { result },
                    },
                };
            });

            response = await withTimeout(
                chat.sendMessage(toolResults),
                EVAL_TIMEOUT_MS
            );
        }

        const text = response.response.text();
        return parseGeminiResponse(text, toolCalls, partyCode, promptId, log);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(partyCode, promptId, "gemini", `error: ${msg}`);
        return autoGreenlit(`Gemini evaluation failed: ${msg}`);
    }
}

function parseGeminiResponse(
    text: string,
    toolCalls: Array<{ tool: string; args: Record<string, string>; result: string }>,
    partyCode: string,
    promptId: string,
    log: LogFn,
): EvaluationResult {
    log(partyCode, promptId, "gemini", `response length: ${text.length}, tool rounds: ${toolCalls.length}`);

    try {
        let cleaned = text.trim();
        if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }

        const parsed = JSON.parse(cleaned);
        const result = validateResult(parsed);
        if (result) return result;
    } catch {
        // Parse failure
    }

    log(partyCode, promptId, "gemini", "response parse failed, auto-greenlit");
    return autoGreenlit("Could not parse Gemini response — auto-approved.");
}

// ─── Timeout utility ───

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
    ]);
}
