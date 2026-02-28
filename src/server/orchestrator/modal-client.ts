/**
 * Purpose: Provide HTTP client access to the Modal bridge service.
 * High-level behavior: Wraps JSON endpoints and SSE streaming.
 * Assumptions: Bridge adheres to the documented API contract.
 * Invariants: All responses are validated before use.
 */

import type { FileChange } from "./result.js";

export interface SandboxConfig {
    image: "base" | "build";
    files: Record<string, string>;
    env: Record<string, string>;
    timeout_s: number;
}

export interface StreamEvent {
    type: "stdout" | "stderr" | "exit";
    data: string;
}

export interface SandboxStatus {
    status: "running" | "completed" | "error";
    uptime_s: number;
}

interface JsonResponse<T> {
    ok: boolean;
    data?: T;
    error?: string;
}

/**
 * Build JSON headers for bridge requests.
 * Does not include authentication headers.
 */
function buildJsonHeaders(): Record<string, string> {
    return { "content-type": "application/json" };
}

/**
 * Read JSON from a fetch response with a success flag.
 * Does not throw; returns ok=false on non-2xx.
 */
async function readJson<T>(response: Response): Promise<JsonResponse<T>> {
    if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as T;
    return { ok: true, data };
}

/**
 * Issue a JSON request and return the parsed body.
 * Throws when the bridge returns a non-2xx status.
 */
async function requestJson<T>(
    url: string,
    init: RequestInit
): Promise<T> {
    const response = await fetch(url, init);
    const parsed = await readJson<T>(response);
    if (!parsed.ok || !parsed.data) {
        throw new Error(parsed.error ?? "Bridge request failed");
    }
    return parsed.data;
}

/**
 * Parse SSE text stream into structured events.
 * Ignores malformed JSON events.
 */
async function* parseSseStream(
    body: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let splitIndex = buffer.indexOf("\n\n");
        while (splitIndex !== -1) {
            const raw = buffer.slice(0, splitIndex).trim();
            buffer = buffer.slice(splitIndex + 2);
            splitIndex = buffer.indexOf("\n\n");

            const dataLines = raw
                .split("\n")
                .filter((line) => line.startsWith("data:"));

            if (dataLines.length === 0) continue;

            const payload = dataLines
                .map((line) => line.replace(/^data:\s*/u, ""))
                .join("\n");

            try {
                const event = JSON.parse(payload) as StreamEvent;
                yield event;
            } catch {
                // Ignore malformed events
            }
        }
    }
}

export class ModalClient {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl.replace(/\/+$/u, "");
    }

    /**
     * Create a sandbox and return its ID.
     * Throws on non-2xx responses.
     */
    async createSandbox(config: SandboxConfig): Promise<string> {
        const url = `${this.baseUrl}/sandbox/create`;
        const response = await requestJson<{ sandbox_id: string }>(
            url,
            {
                method: "POST",
                headers: buildJsonHeaders(),
                body: JSON.stringify(config),
            }
        );
        return response.sandbox_id;
    }

    /**
     * Execute a command and stream stdout/stderr/exit events.
     * Assumes the bridge returns SSE when stream=true.
     */
    async *execStream(
        sandboxId: string,
        command: string[],
        workdir = "/workspace"
    ): AsyncGenerator<StreamEvent> {
        const url = `${this.baseUrl}/sandbox/${sandboxId}/exec`;
        const response = await fetch(url, {
            method: "POST",
            headers: buildJsonHeaders(),
            body: JSON.stringify({ command, workdir, stream: true }),
        });

        if (!response.ok || !response.body) {
            throw new Error("Bridge exec failed");
        }

        for await (const event of parseSseStream(response.body)) {
            yield event;
        }
    }

    /**
     * Read files from the sandbox filesystem.
     * Returns a mapping of path → content.
     */
    async getFiles(
        sandboxId: string,
        paths: string[]
    ): Promise<Record<string, string>> {
        const pathList = encodeURIComponent(paths.join(","));
        const url =
            `${this.baseUrl}/sandbox/${sandboxId}/files?paths=${pathList}`;
        const response = await requestJson<{ files: Record<string, string> }>(
            url,
            { method: "GET" }
        );
        return response.files;
    }

    /**
     * Request diffs from the sandbox against original contents.
     */
    async getDiff(
        sandboxId: string,
        originals: Record<string, string>,
        paths: string[]
    ): Promise<FileChange[]> {
        const url = `${this.baseUrl}/sandbox/${sandboxId}/diff`;
        const response = await requestJson<{ changes: FileChange[] }>(
            url,
            {
                method: "POST",
                headers: buildJsonHeaders(),
                body: JSON.stringify({ originals, paths }),
            }
        );
        return response.changes;
    }

    /**
     * Terminate the sandbox.
     */
    async terminate(sandboxId: string): Promise<void> {
        const url = `${this.baseUrl}/sandbox/${sandboxId}/terminate`;
        await requestJson(url, { method: "POST" });
    }

    /**
     * Get sandbox status.
     */
    async getStatus(sandboxId: string): Promise<SandboxStatus> {
        const url = `${this.baseUrl}/sandbox/${sandboxId}/status`;
        return requestJson<SandboxStatus>(url, { method: "GET" });
    }

    /**
     * Health check endpoint for bridge + Modal connectivity.
     */
    async healthCheck(): Promise<{ modal_connected: boolean }> {
        const url = `${this.baseUrl}/health`;
        return requestJson<{ modal_connected: boolean }>(url, {
            method: "GET",
        });
    }
}
