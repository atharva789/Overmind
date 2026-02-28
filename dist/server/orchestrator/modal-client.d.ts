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
export declare class ModalClient {
    private baseUrl;
    constructor(baseUrl: string);
    /**
     * Create a sandbox and return its ID.
     * Throws on non-2xx responses.
     */
    createSandbox(config: SandboxConfig): Promise<string>;
    /**
     * Execute a command and stream stdout/stderr/exit events.
     * Assumes the bridge returns SSE when stream=true.
     */
    execStream(sandboxId: string, command: string[], workdir?: string): AsyncGenerator<StreamEvent>;
    /**
     * Read files from the sandbox filesystem.
     * Returns a mapping of path → content.
     */
    getFiles(sandboxId: string, paths: string[]): Promise<Record<string, string>>;
    /**
     * Request diffs from the sandbox against original contents.
     */
    getDiff(sandboxId: string, originals: Record<string, string>, paths: string[]): Promise<FileChange[]>;
    /**
     * Terminate the sandbox.
     */
    terminate(sandboxId: string): Promise<void>;
    /**
     * Get sandbox status.
     */
    getStatus(sandboxId: string): Promise<SandboxStatus>;
    /**
     * Health check endpoint for bridge + Modal connectivity.
     */
    healthCheck(): Promise<{
        modal_connected: boolean;
    }>;
}
