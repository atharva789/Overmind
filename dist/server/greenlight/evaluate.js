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
// ─── Auto-greenlit fallback ───
export function autoGreenlit(reason) {
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
export function validateResult(data) {
    const result = EvaluationResultSchema.safeParse(data);
    return result.success ? result.data : null;
}
//# sourceMappingURL=evaluate.js.map