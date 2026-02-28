/**
 * Purpose: Shared compile-time constants used across server and client.
 *
 * High-level behavior: Exports immutable values for error codes, party
 * code generation, networking defaults, and reconnect timing. Contains
 * zero runtime side effects.
 *
 * Assumptions:
 *  - All consumers treat these values as read-only.
 *  - Error codes are never constructed dynamically.
 *
 * Invariants:
 *  - ERROR_CODES keys and values are identical strings (as const).
 *  - PARTY_CODE_ALPHABET excludes ambiguous characters 0, O, I, 1.
 */

export const ERROR_CODES = {
  PARTY_NOT_FOUND: "PARTY_NOT_FOUND",
  JOIN_TIMEOUT: "JOIN_TIMEOUT",
  PARTY_ENDED: "PARTY_ENDED",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  USERNAME_CONFLICT: "USERNAME_CONFLICT",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const PARTY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PARTY_CODE_LENGTH = 4;

export const DEFAULT_PORT = 4444;
export const JOIN_TIMEOUT_MS = 5000;

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 10000];
export const MAX_RECONNECT_DELAY_MS = 10000;

/** Phase 2: deterministic mock greenlight delay in milliseconds. */
export const MOCK_GREENLIGHT_DELAY_MS = 2000;
