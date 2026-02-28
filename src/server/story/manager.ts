// Purpose: Manage FIFO story prompt processing and Gemini streaming.
// Behavior: Queues prompts, writes story chunks, and notifies users.
// Assumptions: Writer and streamer are deterministic and synchronous per call.
// Invariants: Only one story prompt streams at a time across the server.

import { GEMINI_MODEL_DEFAULT, ErrorCode } from "../../shared/constants.js";
import type { ServerMessage } from "../../shared/protocol.js";
import { buildProjectOverview } from "./analysis.js";
import { createGeminiStoryStreamer, StoryStreamError } from "./gemini.js";
import type { StoryStreamer } from "./gemini.js";
import { createStoryWriter } from "./writer.js";
import type { StoryWriter } from "./writer.js";

export interface StoryRequest {
    partyCode: string;
    connectionId: string;
    username: string;
    promptId: string;
    content: string;
    sendTo: (connectionId: string, message: ServerMessage) => void;
    broadcast: (message: ServerMessage, excludeId?: string) => void;
}

export interface StoryManager {
    enqueue(request: StoryRequest): number;
    waitForIdle(): Promise<void>;
}

export interface StoryManagerOptions {
    rootPath: string;
    storyPath: string;
    log: (message: string, partyCode?: string) => void;
    now?: () => number;
    writer?: StoryWriter;
    streamer?: StoryStreamer;
    getApiKey?: () => string | undefined;
    modelName?: string;
    analysisProvider?: () => string;
}

class StoryManagerImpl implements StoryManager {
    private readonly writer: StoryWriter;
    private readonly now: () => number;
    private readonly getApiKey: () => string | undefined;
    private readonly modelName: string;
    private readonly analysisProvider: () => string;
    private readonly log: (message: string, partyCode?: string) => void;
    private readonly queue: StoryRequest[] = [];
    private streamer: StoryStreamer | null = null;
    private overviewCache: string | null = null;
    private processing = false;
    private processingPromise: Promise<void> | null = null;

    constructor(options: StoryManagerOptions) {
        this.writer =
            options.writer ?? createStoryWriter(options.storyPath);
        this.now = options.now ?? (() => Date.now());
        this.getApiKey =
            options.getApiKey ?? (() => process.env["GEMINI_API_KEY"]);
        this.modelName = options.modelName ?? GEMINI_MODEL_DEFAULT;
        this.analysisProvider =
            options.analysisProvider
            ?? (() => buildProjectOverview(options.rootPath));
        this.log = options.log;
        this.streamer = options.streamer ?? null;
    }

    enqueue(request: StoryRequest): number {
        this.queue.push(request);
        const position = this.queue.length + (this.processing ? 1 : 0);
        this.sendQueueMessage(request, position);

        if (!this.processing) {
            this.processingPromise = this.processQueue();
        }

        return position;
    }

    async waitForIdle(): Promise<void> {
        await this.processingPromise;
    }

    private ensureOverview(): string {
        if (!this.overviewCache) {
            const overview = this.analysisProvider();
            this.writer.ensureOverview(overview);
            this.overviewCache = overview;
        }
        return this.overviewCache;
    }

    private ensureStreamer(): StoryStreamer {
        if (this.streamer) return this.streamer;
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw new Error("NO_API_KEY");
        }
        this.streamer = createGeminiStoryStreamer(apiKey, this.modelName);
        return this.streamer;
    }

    private sendQueueMessage(request: StoryRequest, position: number): void {
        if (position <= 1) return;
        const etaSeconds = (position - 1) * 30;
        request.sendTo(request.connectionId, {
            type: "activity",
            payload: {
                username: "system",
                event: `Queued #${position}, Your turn in ~${etaSeconds}s`,
                timestamp: this.now(),
            },
        });
    }

    private notifyStoryStart(request: StoryRequest): void {
        request.broadcast(
            {
                type: "activity",
                payload: {
                    username: `${request.username}'s prompt`,
                    event: "is updating story...",
                    timestamp: this.now(),
                },
            },
            request.connectionId
        );
    }

    private notifyStoryComplete(request: StoryRequest): void {
        request.broadcast({
            type: "activity",
            payload: {
                username: "system",
                event: `✓ Story updated by ${request.username}`,
                timestamp: this.now(),
            },
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;

        while (this.queue.length > 0) {
            const request = this.queue.shift();
            if (!request) continue;
            await this.processRequest(request);
        }

        this.processing = false;
    }

    private async processRequest(request: StoryRequest): Promise<void> {
        let lastOffset = 0;
        try {
            const overview = this.ensureOverview();
            const activeStreamer = this.ensureStreamer();
            lastOffset = this.writer.getSize();

            this.notifyStoryStart(request);

            await activeStreamer.streamStory(
                { analysis: overview, prompt: request.content },
                (chunk) => {
                    if (!chunk) return;
                    lastOffset = this.writer.appendChunk(chunk, this.now());
                    request.sendTo(request.connectionId, {
                        type: "StoryChunk",
                        content: chunk,
                    });
                }
            );

            request.sendTo(request.connectionId, {
                type: "StoryComplete",
                payload: {
                    promptId: request.promptId,
                    timestamp: this.now(),
                },
            });

            this.notifyStoryComplete(request);
        } catch (err) {
            const errorCode = resolveStoryErrorCode(err);
            this.log(
                `Story stream failed for ${request.promptId}: ${errorCode}`,
                request.partyCode
            );
            this.writer.truncate(lastOffset);
            request.sendTo(request.connectionId, {
                type: "error",
                payload: {
                    message: `Story generation failed: ${errorCode}`,
                    code: ErrorCode.STORY_FAILED,
                },
            });
        }
    }
}

export function createStoryManager(options: StoryManagerOptions): StoryManager {
    return new StoryManagerImpl(options);
}

function resolveStoryErrorCode(err: unknown): string {
    if (err instanceof StoryStreamError) return err.code;
    if (err instanceof Error) return err.message;
    return String(err);
}
