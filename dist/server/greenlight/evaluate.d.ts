import { z } from "zod";
export declare const EvaluationResultSchema: z.ZodObject<{
    verdict: z.ZodEnum<["greenlit", "redlit"]>;
    reasoning: z.ZodString;
    conflicts: z.ZodArray<z.ZodString, "many">;
    affectedFiles: z.ZodArray<z.ZodString, "many">;
    executionHints: z.ZodObject<{
        estimatedComplexity: z.ZodEnum<["simple", "moderate", "complex"]>;
        requiresBuild: z.ZodBoolean;
        requiresTests: z.ZodBoolean;
        relatedContextFiles: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        estimatedComplexity: "simple" | "moderate" | "complex";
        requiresBuild: boolean;
        requiresTests: boolean;
        relatedContextFiles: string[];
    }, {
        estimatedComplexity: "simple" | "moderate" | "complex";
        requiresBuild: boolean;
        requiresTests: boolean;
        relatedContextFiles: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    verdict: "greenlit" | "redlit";
    reasoning: string;
    conflicts: string[];
    affectedFiles: string[];
    executionHints: {
        estimatedComplexity: "simple" | "moderate" | "complex";
        requiresBuild: boolean;
        requiresTests: boolean;
        relatedContextFiles: string[];
    };
}, {
    verdict: "greenlit" | "redlit";
    reasoning: string;
    conflicts: string[];
    affectedFiles: string[];
    executionHints: {
        estimatedComplexity: "simple" | "moderate" | "complex";
        requiresBuild: boolean;
        requiresTests: boolean;
        relatedContextFiles: string[];
    };
}>;
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
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
export declare function autoGreenlit(reason: string): EvaluationResult;
export declare function validateResult(data: unknown): EvaluationResult | null;
