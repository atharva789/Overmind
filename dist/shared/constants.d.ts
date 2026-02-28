/**
 * Purpose: Centralize shared constants and configuration defaults.
 * High-level behavior: Exports deterministic values used by server/client.
 * Assumptions: Environment variables are optional and validated at runtime.
 * Invariants: Constants must not include runtime side effects.
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
export declare const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
export declare const GLM_MODEL_DEFAULT = "glm-5.0";
export declare const MAX_TOOL_ROUNDS = 5;
export declare const EVAL_TIMEOUT_MS = 30000;
export declare const MAX_FILE_READ_LINES = 500;
export declare const MAX_SEARCH_RESULTS = 50;
export declare const LOG_TRUNCATE_CHARS = 200;
export declare const MAX_CONTEXT_PAYLOAD_CHARS = 20000;
export declare const MODAL_BRIDGE_PORT: number;
export declare const MODAL_BRIDGE_URL: string;
export declare const OVERMIND_ORCHESTRATOR_URL: string;
export declare const AGENT_CMD: string;
export declare const AGENT_ARGS: string[];
export declare const AGENT_TIMEOUT_S: number;
export declare const OVERMIND_ORCHESTRATOR_POLL_MS: number;
export declare const OVERMIND_ORCHESTRATOR_TIMEOUT_MS: number;
export declare const OVERMIND_WRITE_ALLOWLIST: string[];
export declare const MAX_CONCURRENT_SANDBOXES: number;
export declare const LOCK_TIMEOUT_MS: number;
export declare const LOCK_RETRY_DELAY_MS = 500;
export declare const BRIDGE_HEALTH_INTERVAL_MS: number;
export declare const ALWAYS_SYNC_PATTERNS: string[];
