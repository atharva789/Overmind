import { GoogleGenAI } from "@google/genai";
export declare function checkAndRunStoryAgent(projectRoot: string): Promise<{
    queryId: string;
    type: "new_feature" | "existing";
    title?: string;
}[] | undefined>;
export declare function generateInitialStory(ai: GoogleGenAI, model: string, projectRoot: string, projectId: string, initialContext?: string): Promise<void>;
export declare function regenerateStoryMarkdown(projectRoot: string, projectId: string): Promise<void>;
