export interface ReadContextArgs {
    path: string;
}
/**
 * Read a file or list a directory for project context.
 * Never throws — returns a descriptive string.
 */
export declare function readContext(args: ReadContextArgs): string;
export interface FetchCodeArgs {
    query: string;
    path?: string;
}
/**
 * Search for code patterns in the project using basic substring matching.
 * Never throws — returns a descriptive string.
 */
export declare function fetchCode(args: FetchCodeArgs): string;
import type { FunctionDeclaration } from "@google/generative-ai";
export declare const TOOL_DECLARATIONS: FunctionDeclaration[];
export declare function executeTool(name: string, args: Record<string, string>): string;
