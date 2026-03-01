/**
 * Purpose: Centralize shared constants and configuration defaults.
 * High-level behavior: Exports deterministic values used by server/client.
 * Assumptions: Environment variables are optional and validated at runtime.
 * Invariants: Constants must not include runtime side effects.
 *
 * NOTE: All env-dependent values use getter functions so they read process.env
 * lazily (after dotenv has loaded), not at module import time.
 */
// ─── Error codes ───
export const ErrorCode = {
    PARTY_NOT_FOUND: "PARTY_NOT_FOUND",
    JOIN_TIMEOUT: "JOIN_TIMEOUT",
    PARTY_ENDED: "PARTY_ENDED",
    INVALID_MESSAGE: "INVALID_MESSAGE",
    USERNAME_CONFLICT: "USERNAME_CONFLICT",
    PARTY_FULL: "PARTY_FULL",
    HOST_DISCONNECTED: "HOST_DISCONNECTED",
    EXECUTION_FAILED: "EXECUTION_FAILED",
    MERGE_RESOLUTION_FAILED: "MERGE_RESOLUTION_FAILED",
    MERGE_PR_FAILED: "MERGE_PR_FAILED",
};
// ─── Defaults ───
export const DEFAULT_PORT = 4444;
export const JOIN_TIMEOUT_MS = 5000;
export const PARTY_CODE_LENGTH = 4;
export const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CONNECTION_ID_LENGTH = 12;
export const MAX_MEMBERS_DEFAULT = 8;
export const DISCONNECT_TIMEOUT_MS = 30000;
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
// ─── Reconnect ───
export const RECONNECT_INITIAL_MS = 1000;
export const RECONNECT_MAX_MS = 10000;
// ─── Greenlight ───
export const GREENLIGHT_BACKEND_DEFAULT = "gemini";
export const GEMINI_MODEL_DEFAULT = "gemini-3-flash-preview";
export const GLM_MODEL_DEFAULT = "glm-5.0";
export const MAX_TOOL_ROUNDS = 5;
export const EVAL_TIMEOUT_MS = 30000;
export const MAX_FILE_READ_LINES = 500;
export const MAX_SEARCH_RESULTS = 50;
export const LOG_TRUNCATE_CHARS = 200;
export const MAX_CONTEXT_PAYLOAD_CHARS = 20000;
// ─── Env helpers (lazy reads) ───
function env(key, fallback = "") {
    return process.env[key] ?? fallback;
}
function envNum(key, fallback) {
    const v = process.env[key];
    return v !== undefined ? Number(v) : fallback;
}
// ─── Modal bridge ───
export function get_MODAL_BRIDGE_PORT() { return envNum("OVERMIND_BRIDGE_PORT", 8377); }
export function get_MODAL_BRIDGE_URL() { return `http://localhost:${get_MODAL_BRIDGE_PORT()}`; }
// ─── Merge conflict solver ───
export function get_CONFLICT_RESOLVER_URL() { return env("CONFLICT_RESOLVER_URL"); }
export function get_GITHUB_TOKEN() { return env("GITHUB_TOKEN"); }
export function get_GITHUB_REPO() { return env("GITHUB_REPO"); }
export function get_GITHUB_BASE_BRANCH() { return env("GITHUB_BASE_BRANCH", "main"); }
// ─── Orchestrator ───
export function get_OVERMIND_ORCHESTRATOR_URL() { return env("OVERMIND_ORCHESTRATOR_URL"); }
export function get_AGENT_CMD() { return env("OVERMIND_AGENT_CMD", "claude"); }
export function get_AGENT_ARGS() {
    return env("OVERMIND_AGENT_ARGS", "--dangerously-skip-permissions -p").split(" ");
}
export function get_AGENT_TIMEOUT_S() { return envNum("OVERMIND_AGENT_TIMEOUT", 300); }
export function get_OVERMIND_ORCHESTRATOR_POLL_MS() { return envNum("OVERMIND_ORCHESTRATOR_POLL_MS", 500); }
export function get_OVERMIND_ORCHESTRATOR_TIMEOUT_MS() {
    return envNum("OVERMIND_ORCHESTRATOR_TIMEOUT_MS", 15 * MINUTE_MS);
}
export function get_OVERMIND_WRITE_ALLOWLIST() {
    return env("OVERMIND_WRITE_ALLOWLIST")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
export function get_MAX_CONCURRENT_SANDBOXES() { return envNum("OVERMIND_MAX_AGENTS", 3); }
export const LOCK_TIMEOUT_MS = 5 * MINUTE_MS;
export const LOCK_RETRY_DELAY_MS = 500;
export const BRIDGE_HEALTH_INTERVAL_MS = 10 * SECOND_MS;
export function get_ALWAYS_SYNC_PATTERNS() {
    return env("OVERMIND_ALWAYS_SYNC", "context.md,package.json,tsconfig.json").split(",");
}
// ─── Backward-compatible aliases (lazy via getter) ───
// These exist so existing code that imports e.g. MODAL_BRIDGE_PORT still works.
// The value is read fresh from process.env on every access.
export { get_MODAL_BRIDGE_PORT as MODAL_BRIDGE_PORT };
export { get_MODAL_BRIDGE_URL as MODAL_BRIDGE_URL };
export { get_CONFLICT_RESOLVER_URL as CONFLICT_RESOLVER_URL };
export { get_GITHUB_TOKEN as GITHUB_TOKEN };
export { get_GITHUB_REPO as GITHUB_REPO };
export { get_GITHUB_BASE_BRANCH as GITHUB_BASE_BRANCH };
export { get_OVERMIND_ORCHESTRATOR_URL as OVERMIND_ORCHESTRATOR_URL };
export { get_AGENT_CMD as AGENT_CMD };
export { get_AGENT_ARGS as AGENT_ARGS };
export { get_AGENT_TIMEOUT_S as AGENT_TIMEOUT_S };
export { get_OVERMIND_ORCHESTRATOR_POLL_MS as OVERMIND_ORCHESTRATOR_POLL_MS };
export { get_OVERMIND_ORCHESTRATOR_TIMEOUT_MS as OVERMIND_ORCHESTRATOR_TIMEOUT_MS };
export { get_OVERMIND_WRITE_ALLOWLIST as OVERMIND_WRITE_ALLOWLIST };
export { get_MAX_CONCURRENT_SANDBOXES as MAX_CONCURRENT_SANDBOXES };
export { get_ALWAYS_SYNC_PATTERNS as ALWAYS_SYNC_PATTERNS };
//# sourceMappingURL=constants.js.map