/**
 * Purpose: Centralize shared constants and configuration defaults.
 * High-level behavior: Exports deterministic values used by server/client.
 * Assumptions: Environment variables are optional and validated at runtime.
 * Invariants: Constants must not include runtime side effects.
 *
 * NOTE: All env-dependent values use getter functions so they read process.env
 * lazily (after dotenv has loaded), not at module import time.
 */
export declare const ErrorCode: {
    readonly PARTY_NOT_FOUND: "PARTY_NOT_FOUND";
    readonly JOIN_TIMEOUT: "JOIN_TIMEOUT";
    readonly PARTY_ENDED: "PARTY_ENDED";
    readonly INVALID_MESSAGE: "INVALID_MESSAGE";
    readonly USERNAME_CONFLICT: "USERNAME_CONFLICT";
    readonly PARTY_FULL: "PARTY_FULL";
    readonly HOST_DISCONNECTED: "HOST_DISCONNECTED";
    readonly EXECUTION_FAILED: "EXECUTION_FAILED";
    readonly MERGE_RESOLUTION_FAILED: "MERGE_RESOLUTION_FAILED";
    readonly MERGE_PR_FAILED: "MERGE_PR_FAILED";
};
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];
export declare const DEFAULT_PORT = 4444;
export declare const JOIN_TIMEOUT_MS = 5000;
export declare const PARTY_CODE_LENGTH = 4;
export declare const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export declare const CONNECTION_ID_LENGTH = 12;
export declare const MAX_MEMBERS_DEFAULT = 8;
export declare const DISCONNECT_TIMEOUT_MS = 30000;
export declare const SECOND_MS = 1000;
export declare const MINUTE_MS: number;
export declare const RECONNECT_INITIAL_MS = 1000;
export declare const RECONNECT_MAX_MS = 10000;
export declare const GREENLIGHT_BACKEND_DEFAULT = "gemini";
export declare const GEMINI_MODEL_DEFAULT = "gemini-2.5-pro";
export declare const GLM_MODEL_DEFAULT = "glm-5.0";
export declare const MAX_TOOL_ROUNDS = 5;
export declare const EVAL_TIMEOUT_MS = 30000;
export declare const MAX_FILE_READ_LINES = 500;
export declare const MAX_SEARCH_RESULTS = 50;
export declare const LOG_TRUNCATE_CHARS = 200;
export declare const MAX_CONTEXT_PAYLOAD_CHARS = 20000;
export declare function get_MODAL_BRIDGE_PORT(): number;
export declare function get_MODAL_BRIDGE_URL(): string;
export declare function get_CONFLICT_RESOLVER_URL(): string;
export declare function get_GITHUB_TOKEN(): string;
export declare function get_GITHUB_REPO(): string;
export declare function get_GITHUB_BASE_BRANCH(): string;
export declare function get_OVERMIND_ORCHESTRATOR_URL(): string;
export declare function get_AGENT_CMD(): string;
export declare function get_AGENT_ARGS(): string[];
export declare function get_AGENT_TIMEOUT_S(): number;
export declare function get_OVERMIND_ORCHESTRATOR_POLL_MS(): number;
export declare function get_OVERMIND_ORCHESTRATOR_TIMEOUT_MS(): number;
export declare function get_OVERMIND_WRITE_ALLOWLIST(): string[];
export declare function get_MAX_CONCURRENT_SANDBOXES(): number;
export declare const LOCK_TIMEOUT_MS: number;
export declare const LOCK_RETRY_DELAY_MS = 500;
export declare const BRIDGE_HEALTH_INTERVAL_MS: number;
export declare function get_ALWAYS_SYNC_PATTERNS(): string[];
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
