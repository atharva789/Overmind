// Purpose: Persist story content to story.md in append-only chunks.
// Behavior: Ensures the overview exists and appends chunk delimiters.
// Assumptions: storyPath is writable and points to a file in the project root.
// Invariants: appendChunk returns the file size before the new chunk is added.

import fs from "node:fs";

export interface StoryWriter {
    ensureOverview(overview: string): void;
    appendChunk(chunk: string, timestamp: number): number;
    truncate(size: number): void;
    getSize(): number;
}

export function createStoryWriter(storyPath: string): StoryWriter {
    return {
        ensureOverview: (overview: string) => {
            ensureStoryOverview(storyPath, overview);
        },
        appendChunk: (chunk: string, timestamp: number) => {
            return appendStoryChunk(storyPath, chunk, timestamp);
        },
        truncate: (size: number) => {
            truncateStory(storyPath, size);
        },
        getSize: () => getStorySize(storyPath),
    };
}

function ensureStoryOverview(storyPath: string, overview: string): void {
    if (!fs.existsSync(storyPath)) {
        fs.writeFileSync(storyPath, overview, "utf-8");
        return;
    }

    const stats = fs.statSync(storyPath);
    if (stats.size === 0) {
        fs.writeFileSync(storyPath, overview, "utf-8");
    }
}

function appendStoryChunk(
    storyPath: string,
    chunk: string,
    timestamp: number
): number {
    const sizeBefore = getStorySize(storyPath);
    const delimiter = `\n<!-- chunk_${timestamp} -->\n`;
    fs.appendFileSync(storyPath, delimiter + chunk, "utf-8");
    return sizeBefore;
}

function truncateStory(storyPath: string, size: number): void {
    try {
        fs.truncateSync(storyPath, size);
    } catch {
        // If truncate fails, allow error handling to continue.
    }
}

function getStorySize(storyPath: string): number {
    try {
        return fs.statSync(storyPath).size;
    } catch {
        return 0;
    }
}
