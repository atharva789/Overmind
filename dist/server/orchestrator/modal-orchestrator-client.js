/**
 * Purpose: Provide HTTP client access to the Modal orchestrator service.
 * High-level behavior: Creates runs, polls status, and cancels runs with retry.
 * Assumptions: The base URL points to the orchestrator root (no /runs).
 * Invariants: All responses are schema-validated before use.
 */
import { z } from "zod";
import { OVERMIND_ORCHESTRATOR_TIMEOUT_MS } from "../../shared/constants.js";
const MAX_RETRIES = 2;
const RunCreateResponseSchema = z.object({
    runId: z.string(),
});
const RunStatusSchema = z.object({
    status: z.enum([
        "queued",
        "running",
        "completed",
        "failed",
        "canceled",
    ]),
    stage: z.string().optional(),
    detail: z.string().optional(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
});
const RunCancelResponseSchema = z.object({
    ok: z.boolean(),
});
class OrchestratorHttpError extends Error {
    status;
    /**
     * Record an HTTP status error.
     * Does not include response bodies.
     * Edge cases: Accepts any numeric status.
     * Invariants: Status is stored on the error instance.
     */
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/**
 * Build JSON headers for orchestrator requests.
 * Does not include authentication headers.
 * Edge cases: None.
 * Invariants: Always returns Content-Type: application/json.
 */
function buildJsonHeaders() {
    return { "Content-Type": "application/json" };
}
/**
 * Determine if an HTTP status should be retried.
 * Does not retry client errors.
 * Edge cases: Treats 502/503/504 as transient.
 * Invariants: Returns false for all 4xx responses.
 */
function isTransientStatus(status) {
    return status === 502 || status === 503 || status === 504;
}
/**
 * Read and validate JSON from a Response.
 * Does not retry or log errors.
 * Edge cases: Throws on non-2xx or invalid JSON.
 * Invariants: Returned data matches the schema.
 */
async function readJson(response, schema) {
    if (!response.ok) {
        throw new OrchestratorHttpError(response.status, `HTTP ${response.status}`);
    }
    let data;
    try {
        data = await response.json();
    }
    catch (error) {
        throw new Error(`Invalid JSON: ${String(error)}`);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        throw new Error(`Invalid response schema: ${parsed.error.message}`);
    }
    return parsed.data;
}
/**
 * Issue a fetch request with a timeout.
 * Does not retry; caller handles retries.
 * Edge cases: Aborts when timeout elapses.
 * Invariants: Always clears the timeout timer.
 */
async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Execute a request with limited retries for transient failures.
 * Does not retry validation errors.
 * Edge cases: Retries only on network errors and 5xx statuses.
 * Invariants: Attempts are capped at MAX_RETRIES.
 */
async function requestJsonWithRetry(url, init, schema, log, timeoutMs) {
    let attempt = 0;
    while (true) {
        try {
            const response = await fetchWithTimeout(url, init, timeoutMs);
            return await readJson(response, schema);
        }
        catch (error) {
            const isHttpError = error instanceof OrchestratorHttpError;
            const status = isHttpError ? error.status : null;
            const isTransient = status ? isTransientStatus(status) : true;
            if (attempt >= MAX_RETRIES || !isTransient) {
                throw error;
            }
            attempt += 1;
            log(`retrying orchestrator request (attempt ${attempt})`);
        }
    }
}
export class ModalOrchestratorClient {
    baseUrl;
    log;
    timeoutMs;
    /**
     * Create a Modal orchestrator client instance.
     * Does not validate the remote URL.
     * Edge cases: Strips trailing slashes from the base URL.
     * Invariants: baseUrl never ends with '/'.
     */
    constructor(baseUrl, log) {
        this.baseUrl = baseUrl.replace(/\/+$/u, "");
        this.log = log;
        this.timeoutMs = OVERMIND_ORCHESTRATOR_TIMEOUT_MS();
    }
    /**
     * Create a new run in the orchestrator.
     * Does not log prompt contents.
     * Edge cases: Throws on invalid responses.
     * Invariants: Returns the validated runId.
     */
    async createRun(payload) {
        const url = `${this.baseUrl}/runs`;
        const body = JSON.stringify(payload);
        const response = await requestJsonWithRetry(url, { method: "POST", headers: buildJsonHeaders(), body }, RunCreateResponseSchema, this.log, this.timeoutMs);
        if (response.runId !== payload.runId) {
            throw new Error("Orchestrator returned unexpected runId");
        }
        return response.runId;
    }
    /**
     * Fetch the current status for a run.
     * Does not retry on schema errors.
     * Edge cases: Throws when run is missing.
     * Invariants: Returns a validated RunStatus object.
     */
    async getRun(runId) {
        const url = `${this.baseUrl}/runs/${runId}`;
        return requestJsonWithRetry(url, { method: "GET", headers: buildJsonHeaders() }, RunStatusSchema, this.log, this.timeoutMs);
    }
    /**
     * Request run cancellation.
     * Does not assume cancellation is immediate.
     * Edge cases: Throws on non-OK responses.
     * Invariants: Resolves only when the orchestrator responds ok.
     */
    async cancelRun(runId) {
        const url = `${this.baseUrl}/runs/${runId}/cancel`;
        const response = await requestJsonWithRetry(url, { method: "POST", headers: buildJsonHeaders() }, RunCancelResponseSchema, this.log, this.timeoutMs);
        if (!response.ok) {
            throw new Error("Orchestrator cancel failed");
        }
    }
}
//# sourceMappingURL=modal-orchestrator-client.js.map