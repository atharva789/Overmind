import { z } from "zod";

// ─── EvaluationResult (same contract for both backends) ───

export const EvaluationResultSchema = z.object({
    verdict: z.enum(["greenlit", "redlit"]),
    reasoning: z.string(),
    conflicts: z.array(z.string()),
    affectedFiles: z.array(z.string()),
    executionHints: z.object({
        estimatedComplexity: z.enum(["simple", "moderate", "complex"]),
        requiresBuild: z.boolean(),
        requiresTests: z.boolean(),
        relatedContextFiles: z.array(z.string()),
    }),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ─── GLM Context Bundle ───

export interface GlmEvalRequest {
    prompt: {
        promptId: string;
        content: string;
        scope?: string[];
    };
    concurrent: Array<{
        promptId: string;
        scope?: string[];
        contentSummary?: string;
    }>;
    overlapHint: {
        overlaps: boolean;
        conflictPromptIds: string[];
        notes: string;
    };
    projectContext: {
        rootContext: string;
        relatedContextFiles: Array<{
            path: string;
            content: string;
        }>;
        codeSnippets: Array<{
            path: string;
            content: string;
            note?: string;
        }>;
        fileListing?: string;
        searchResults?: string;
    };
    constraints: {
        mustNotLeakPromptContent: boolean;
        jsonOnly: boolean;
    };
}

// ─── Auto-greenlit fallback ───

export function autoGreenlit(reason: string): EvaluationResult {
    return {
        verdict: "greenlit",
        reasoning: reason,
        conflicts: [],
        affectedFiles: [],
        executionHints: {
            estimatedComplexity: "simple",
            requiresBuild: false,
            requiresTests: false,
            relatedContextFiles: [],
        },
    };
}

// ─── Validation helper ───

export function validateResult(data: unknown): EvaluationResult | null {
    const result = EvaluationResultSchema.safeParse(data);
    return result.success ? result.data : null;
}
