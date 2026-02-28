/**
 * Purpose: Provide HTTP client access to the Modal orchestrator service.
 * High-level behavior: Creates runs, polls status, and cancels runs with retry.
 * Assumptions: The base URL points to the orchestrator root (no /runs).
 * Invariants: All responses are schema-validated before use.
 */
export interface RunCreatePayload {
    runId: string;
    promptId: string;
    prompt: string;
    story: string;
    scope: string[];
    files: Record<string, string>;
}
export interface RunStatus {
    status: "queued" | "running" | "completed" | "failed" | "canceled";
    stage?: string;
    detail?: string;
    files?: Array<{
        path: string;
        content: string;
    }>;
    summary?: string;
    error?: string;
}
type LogFn = (message: string) => void;
export declare class ModalOrchestratorClient {
    private baseUrl;
    private log;
    private timeoutMs;
    /**
     * Create a Modal orchestrator client instance.
     * Does not validate the remote URL.
     * Edge cases: Strips trailing slashes from the base URL.
     * Invariants: baseUrl never ends with '/'.
     */
    constructor(baseUrl: string, log: LogFn);
    /**
     * Create a new run in the orchestrator.
     * Does not log prompt contents.
     * Edge cases: Throws on invalid responses.
     * Invariants: Returns the validated runId.
     */
    createRun(payload: RunCreatePayload): Promise<string>;
    /**
     * Fetch the current status for a run.
     * Does not retry on schema errors.
     * Edge cases: Throws when run is missing.
     * Invariants: Returns a validated RunStatus object.
     */
    getRun(runId: string): Promise<RunStatus>;
    /**
     * Request run cancellation.
     * Does not assume cancellation is immediate.
     * Edge cases: Throws on non-OK responses.
     * Invariants: Resolves only when the orchestrator responds ok.
     */
    cancelRun(runId: string): Promise<void>;
}
export {};
