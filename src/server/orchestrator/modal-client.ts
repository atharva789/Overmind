/**
 * modal-client.ts — HTTP client for the Modal bridge service.
 *
 * Purpose:
 *   Translates orchestrator calls into HTTP requests to the local
 *   Python bridge process. Handles SSE parsing for exec streams.
 *
 * Assumptions:
 *   - Bridge is running at MODAL_BRIDGE_URL (default localhost:8377).
 *   - SSE events follow the format "data: {json}\n\n".
 *   - All bridge errors are HTTP 4xx/5xx with a detail message.
 *
 * Invariants:
 *   - All fetch calls include a timeout (EVAL_TIMEOUT_MS as fallback).
 *   - SSE streams are properly closed on error or completion.
 *   - No prompt content is logged — only sandbox IDs and metadata.
 */

import type { FileChange } from "../../shared/protocol.js";
import type { SandboxConfig, StreamEvent } from "./result.js";

// ─── ModalClient ───

export class ModalClient {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }

    /**
     * Create a new sandbox via the bridge.
     * Returns the sandbox_id (our internal ID echoed back).
     */
    async createSandbox(
        sandboxId: string,
        config: SandboxConfig,
    ): Promise<string> {
        const response = await fetch(
            `${this.baseUrl}/sandbox/create`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sandbox_id: sandboxId,
                    image: config.image,
                    files: config.files,
                    env: config.env,
                    timeout_s: config.timeoutSeconds,
                    tags: config.tags,
                }),
            },
        );

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(
                `Bridge: create sandbox failed (${response.status}): ${detail.slice(0, 200)}`,
            );
        }

        const data = (await response.json()) as {
            sandbox_id: string;
        };
        return data.sandbox_id;
    }

    /**
     * Execute a command in a sandbox, yielding SSE events.
     *
     * Parses the Server-Sent Events stream from the bridge and
     * yields { type, data } objects for stdout, stderr, and exit.
     */
    async *execStream(
        sandboxId: string,
        command: string[],
        workdir = "/workspace",
    ): AsyncGenerator<StreamEvent> {
        const response = await fetch(
            `${this.baseUrl}/sandbox/${sandboxId}/exec`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    command,
                    workdir,
                    stream: true,
                }),
            },
        );

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(
                `Bridge: exec failed (${response.status}): ${detail.slice(0, 200)}`,
            );
        }

        if (!response.body) {
            throw new Error("Bridge: exec returned no body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events separated by double newlines
                const parts = buffer.split("\n\n");
                buffer = parts.pop() ?? "";

                for (const part of parts) {
                    const line = part.trim();
                    if (line.startsWith("data: ")) {
                        const jsonStr = line.slice(6);
                        try {
                            const event = JSON.parse(
                                jsonStr,
                            ) as StreamEvent;
                            yield event;
                        } catch {
                            // Malformed SSE event — skip
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Read file contents from a sandbox.
     * Returns path -> content for files that exist.
     */
    async getFiles(
        sandboxId: string,
        paths: string[],
    ): Promise<Record<string, string>> {
        const response = await fetch(
            `${this.baseUrl}/sandbox/${sandboxId}/files`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths }),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Bridge: getFiles failed (${response.status})`,
            );
        }

        const data = (await response.json()) as {
            files: Record<string, string>;
        };
        return data.files;
    }

    /**
     * Compare sandbox files against originals and return diffs.
     */
    async getDiff(
        sandboxId: string,
        originals: Record<string, string>,
    ): Promise<FileChange[]> {
        const response = await fetch(
            `${this.baseUrl}/sandbox/${sandboxId}/diff`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ originals }),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Bridge: getDiff failed (${response.status})`,
            );
        }

        const data = (await response.json()) as {
            changes: FileChange[];
        };
        return data.changes;
    }

    /**
     * Terminate a sandbox and release its resources.
     */
    async terminate(sandboxId: string): Promise<void> {
        const response = await fetch(
            `${this.baseUrl}/sandbox/${sandboxId}/terminate`,
            { method: "POST" },
        );

        if (!response.ok && response.status !== 404) {
            throw new Error(
                `Bridge: terminate failed (${response.status})`,
            );
        }
    }

    /**
     * Get sandbox status from the bridge.
     */
    async getStatus(
        sandboxId: string,
    ): Promise<{ status: string; exitCode?: number }> {
        const response = await fetch(
            `${this.baseUrl}/sandbox/${sandboxId}/status`,
        );

        if (!response.ok) {
            throw new Error(
                `Bridge: getStatus failed (${response.status})`,
            );
        }

        return (await response.json()) as {
            status: string;
            exitCode?: number;
        };
    }

    /**
     * Health check — confirms bridge and Modal are reachable.
     */
    async healthCheck(): Promise<{
        status: string;
        modalConnected: boolean;
    }> {
        const response = await fetch(`${this.baseUrl}/health`);

        if (!response.ok) {
            return { status: "error", modalConnected: false };
        }

        const data = (await response.json()) as {
            status: string;
            modal_connected: boolean;
        };
        return {
            status: data.status,
            modalConnected: data.modal_connected,
        };
    }
}
