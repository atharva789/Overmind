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
export function detectScopeOverlap(
    current: PromptEntry,
    concurrent: PromptEntry[]
): OverlapResult {
    if (concurrent.length === 0) {
        return { overlaps: false, conflictPromptIds: [], notes: "No concurrent prompts." };
    }

    const currentScope = current.scope ?? [];

    // If this prompt has no scope, flag potential overlap with all concurrent
    if (currentScope.length === 0) {
        const otherIds = concurrent.map((p) => p.promptId);
        return {
            overlaps: concurrent.length > 0,
            conflictPromptIds: otherIds,
            notes: "Prompt has no scope — may overlap with concurrent prompts.",
        };
    }

    const conflictIds: string[] = [];
    const notes: string[] = [];

    for (const other of concurrent) {
        const otherScope = other.scope ?? [];

        // No scope on other → potential overlap
        if (otherScope.length === 0) {
            conflictIds.push(other.promptId);
            notes.push(`${other.promptId}: no scope defined, may overlap.`);
            continue;
        }

        // Check for direct file/path overlap
        const overlap = currentScope.filter((s) =>
            otherScope.some((os) => s === os || s.startsWith(os) || os.startsWith(s))
        );

        if (overlap.length > 0) {
            conflictIds.push(other.promptId);
            notes.push(`${other.promptId}: overlapping scope [${overlap.join(", ")}]`);
        }
    }

    return {
        overlaps: conflictIds.length > 0,
        conflictPromptIds: conflictIds,
        notes: notes.join("; ") || "No scope overlap detected.",
    };
}
