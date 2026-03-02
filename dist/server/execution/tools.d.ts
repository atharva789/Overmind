import type { FunctionDeclaration } from "@google/genai";
export declare const EXECUTION_TOOL_DECLARATIONS: FunctionDeclaration[];
export interface FileChange {
    path: string;
    diff: string;
    linesAdded: number;
    linesRemoved: number;
}
export declare class WorkspaceContext {
    changes: FileChange[];
    private projectRoot;
    constructor(projectRoot?: string);
    executeTool(name: string, args: Record<string, string>): {
        success: boolean;
        result?: string;
        error?: string;
    };
}
