import type { PromptEntry } from "../party.js";
import type { EvaluationResult } from "./evaluate.js";
export declare function greenlightLog(partyCode: string, promptId: string, backend: string, message: string): void;
/**
 * Evaluate a prompt using the configured backend.
 * Fallback chain: GLM Modal → Gemini → auto-greenlit.
 */
export declare function evaluatePrompt(entry: PromptEntry, concurrent: PromptEntry[], partyCode: string): Promise<EvaluationResult>;
