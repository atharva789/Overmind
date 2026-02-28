import type { GlmEvalRequest, EvaluationResult } from "../evaluate.js";
export type LogFn = (partyCode: string, promptId: string, backend: string, msg: string) => void;
/**
 * Evaluate a prompt via the GLM 5.0 Modal sandbox.
 * POSTs pre-computed context bundle. No tool calls.
 */
export declare function evaluateWithGlmModal(req: GlmEvalRequest, partyCode: string, promptId: string, log: LogFn, timeoutMs?: number): Promise<EvaluationResult>;
