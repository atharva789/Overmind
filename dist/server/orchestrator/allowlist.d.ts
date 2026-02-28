/**
 * Purpose: Provide allowlist matching helpers for orchestrator file writes.
 * High-level behavior: Normalizes paths and matches simple patterns.
 * Assumptions: Patterns are suffixes or direct path matches.
 * Invariants: Matching is deterministic and path-normalized.
 */
import type { EvaluationResult } from "../../shared/protocol.js";
/**
 * Normalize a relative path for consistent matching.
 * Does not access the filesystem.
 * Edge cases: Converts Windows separators to POSIX.
 * Invariants: Returned paths never contain backslashes.
 */
export declare function normalizeRelativePath(relPath: string): string;
/**
 * Build a predicate to check if a path is in the allowed set.
 * Does not mutate the evaluation or allowlist inputs.
 * Edge cases: Empty allowlists still allow explicit affected files.
 * Invariants: The predicate only allows normalized paths.
 */
export declare function buildAllowedPathChecker(evaluation: EvaluationResult, allowlistPatterns: string[]): (relPath: string) => boolean;
