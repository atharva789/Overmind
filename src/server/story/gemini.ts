// Purpose: Stream story content from Gemini using generateContentStream().
// Behavior: Emits text chunks via callback as the model streams responses.
// Assumptions: API key and model name are valid for Gemini access.
// Invariants: Chunks are emitted in order and without buffering.

import { GoogleGenerativeAI } from "@google/generative-ai";

export interface StoryStreamInput {
    analysis: string;
    prompt: string;
}

export interface StoryStreamer {
    streamStory(
        input: StoryStreamInput,
        onChunk: (chunk: string) => void
    ): Promise<void>;
}

export class StoryStreamError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

export function createGeminiStoryStreamer(
    apiKey: string,
    modelName: string
): StoryStreamer {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    return {
        streamStory: async (
            input: StoryStreamInput,
            onChunk: (chunk: string) => void
        ) => {
            const systemPrompt = buildSystemPrompt(input.analysis);
            const userPrompt = buildUserPrompt(input.prompt);

            try {
                const result = await model.generateContentStream({
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: userPrompt }],
                        },
                    ],
                    systemInstruction: systemPrompt,
                });

                for await (const chunk of result.stream) {
                    const text = chunk.text();
                    if (text) {
                        onChunk(text);
                    }
                }
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                throw new StoryStreamError("STREAM_ERROR", message);
            }
        },
    };
}

function buildSystemPrompt(analysis: string): string {
    return [
        "You are a story generation assistant for the Overmind project.",
        "Use the project overview below for context and continuity.",
        "",
        analysis,
        "",
        "Write narrative story content that fits the prompt.",
    ].join("\n");
}

function buildUserPrompt(prompt: string): string {
    return [
        "Story prompt from user:",
        prompt,
        "",
        "Continue the story with clear, readable prose.",
    ].join("\n");
}
