/**
 * Purpose: Centralize shared constants and configuration defaults.
 * High-level behavior: Exports deterministic values used by server/client.
 * Assumptions: Environment variables are optional and validated at runtime.
 * Invariants: Constants must not include runtime side effects.
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
    PROJECT_MISMATCH: "PROJECT_MISMATCH",
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
export const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
export const GLM_MODEL_DEFAULT = "glm-5.0";
export const MAX_TOOL_ROUNDS = 5;
export const EVAL_TIMEOUT_MS = 30000;
export const MAX_FILE_READ_LINES = 500;
export const MAX_SEARCH_RESULTS = 50;
export const LOG_TRUNCATE_CHARS = 200;
export const MAX_CONTEXT_PAYLOAD_CHARS = 20000;
// ─── Modal bridge ───
export const MODAL_BRIDGE_PORT = Number(process.env["OVERMIND_BRIDGE_PORT"] ?? "8377");
export const MODAL_BRIDGE_URL = `http://localhost:${MODAL_BRIDGE_PORT}`;
// ─── Orchestrator ───
export const AGENT_CMD = process.env["OVERMIND_AGENT_CMD"] ?? "claude";
export const AGENT_ARGS = (process.env["OVERMIND_AGENT_ARGS"]
    ?? "--dangerously-skip-permissions -p").split(" ");
export const AGENT_TIMEOUT_S = Number(process.env["OVERMIND_AGENT_TIMEOUT"] ?? "300");
export const MAX_CONCURRENT_SANDBOXES = Number(process.env["OVERMIND_MAX_AGENTS"] ?? "3");
export const LOCK_TIMEOUT_MS = 5 * MINUTE_MS;
export const LOCK_RETRY_DELAY_MS = 500;
export const BRIDGE_HEALTH_INTERVAL_MS = 10 * SECOND_MS;
export const ALWAYS_SYNC_PATTERNS = (process.env["OVERMIND_ALWAYS_SYNC"] ??
    "context.md,package.json,tsconfig.json").split(",");
//# sourceMappingURL=constants.js.map