// Purpose: Centralize shared constants and error codes.
// Behavior: Exposes server/client configuration and status identifiers.
// Assumptions: Constants are immutable and referenced across modules.
// Invariants: Values remain deterministic and environment-agnostic.

// ─── Error codes ───
export const ErrorCode = {
    PARTY_NOT_FOUND: "PARTY_NOT_FOUND",
    JOIN_TIMEOUT: "JOIN_TIMEOUT",
    PARTY_ENDED: "PARTY_ENDED",
    INVALID_MESSAGE: "INVALID_MESSAGE",
    USERNAME_CONFLICT: "USERNAME_CONFLICT",
    PARTY_FULL: "PARTY_FULL",
    HOST_DISCONNECTED: "HOST_DISCONNECTED",
    REPO_INVALID: "REPO_INVALID",
    REPO_MISMATCH: "REPO_MISMATCH",
    STORY_INVALID: "STORY_INVALID",
    STORY_FAILED: "STORY_FAILED",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

// ─── Defaults ───
export const DEFAULT_PORT = 4444;
export const JOIN_TIMEOUT_MS = 5000;
export const PARTY_CODE_LENGTH = 4;
export const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CONNECTION_ID_LENGTH = 12;
export const MAX_MEMBERS_DEFAULT = 8;
export const DISCONNECT_TIMEOUT_MS = 30000;

// ─── Reconnect ───
export const RECONNECT_INITIAL_MS = 1000;
export const RECONNECT_MAX_MS = 10000;

// ─── Execution ───
export const GEMINI_MODEL_DEFAULT = "gemini-2.0-flash";
