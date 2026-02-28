import type { EvaluationResult } from "../evaluate.js";
import type { OverlapResult } from "../conflict.js";
export type LogFn = (partyCode: string, promptId: string, backend: string, msg: string) => void;
export declare function evaluateWithGemini(promptContent: string, promptScope: string[] | undefined, overlapHint: OverlapResult, partyCode: string, promptId: string, log: LogFn): Promise<EvaluationResult>;
