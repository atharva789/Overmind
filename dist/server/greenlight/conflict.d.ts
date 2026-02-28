import type { PromptEntry } from "../party.js";
export interface OverlapResult {
    overlaps: boolean;
    conflictPromptIds: string[];
    notes: string;
}
/**
 * Detect scope overlap between the current prompt and concurrent prompts.
 * This is a fast local check — the model is the final decider.
 */
export declare function detectScopeOverlap(current: PromptEntry, concurrent: PromptEntry[]): OverlapResult;
