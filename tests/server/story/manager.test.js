// Purpose: Verify FIFO story queue processing and error rollback.
// Behavior: Uses fakes to simulate streaming and file writes.
// Assumptions: Tests run after build and import from dist outputs.
// Invariants: Queue order and rollback behavior are deterministic.

import test from "node:test";
import assert from "node:assert/strict";
import { createStoryManager } from "../../../dist/server/story/manager.js";
import { ErrorCode } from "../../../dist/shared/constants.js";

function createFakeWriter() {
    return {
        size: 0,
        chunks: [],
        lastTruncate: null,
        ensureOverviewCalls: 0,
        ensureOverview: function () {
            this.ensureOverviewCalls += 1;
        },
        appendChunk: function (chunk) {
            const sizeBefore = this.size;
            this.size += chunk.length;
            this.chunks.push(chunk);
            return sizeBefore;
        },
        truncate: function (size) {
            this.lastTruncate = size;
            this.size = size;
        },
        getSize: function () {
            return this.size;
        },
    };
}

test("story manager processes prompts in FIFO order", async () => {
    const sentChunks = [];
    const fakeWriter = createFakeWriter();
    const fakeStreamer = {
        streamStory: async (input, onChunk) => {
            onChunk(input.prompt);
        },
    };

    const manager = createStoryManager({
        rootPath: ".",
        storyPath: "story.md",
        log: () => {},
        writer: fakeWriter,
        streamer: fakeStreamer,
        analysisProvider: () => "overview",
        now: () => 1,
    });

    manager.enqueue({
        partyCode: "ABCD",
        connectionId: "c1",
        username: "alice",
        promptId: "p1",
        content: "first",
        sendTo: (_id, message) => {
            if (message.type === "StoryChunk") {
                sentChunks.push(message.content);
            }
        },
        broadcast: () => {},
    });

    manager.enqueue({
        partyCode: "ABCD",
        connectionId: "c2",
        username: "bob",
        promptId: "p2",
        content: "second",
        sendTo: (_id, message) => {
            if (message.type === "StoryChunk") {
                sentChunks.push(message.content);
            }
        },
        broadcast: () => {},
    });

    await manager.waitForIdle();
    assert.deepEqual(sentChunks, ["first", "second"]);
});

test("story manager rolls back last chunk on stream error", async () => {
    const fakeWriter = createFakeWriter();
    const errors = [];
    const fakeStreamer = {
        streamStory: async (_input, onChunk) => {
            onChunk("chunk");
            throw new Error("STREAM_FAIL");
        },
    };

    const manager = createStoryManager({
        rootPath: ".",
        storyPath: "story.md",
        log: () => {},
        writer: fakeWriter,
        streamer: fakeStreamer,
        analysisProvider: () => "overview",
        now: () => 1,
    });

    manager.enqueue({
        partyCode: "WXYZ",
        connectionId: "c3",
        username: "carol",
        promptId: "p3",
        content: "fail",
        sendTo: (_id, message) => {
            if (message.type === "error") {
                errors.push(message.payload.code);
            }
        },
        broadcast: () => {},
    });

    await manager.waitForIdle();
    assert.equal(fakeWriter.lastTruncate, 0);
    assert.equal(errors[0], ErrorCode.STORY_FAILED);
});
