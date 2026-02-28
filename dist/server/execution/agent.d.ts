import type { PromptEntry } from "../party.js";
import { FileChange } from "./tools.js";
export interface ExecutionResult {
    success: boolean;
    files: FileChange[];
    summary: string;
}
export type LogFn = (partyCode: string, promptId: string, module: string, msg: string) => void;
export declare function executePromptChanges(entry: PromptEntry, partyCode: string, log: LogFn): Promise<ExecutionResult>;
