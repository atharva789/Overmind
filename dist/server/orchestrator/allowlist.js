/**
 * Purpose: Provide allowlist matching helpers for orchestrator file writes.
 * High-level behavior: Normalizes paths and matches simple patterns.
 * Assumptions: Patterns are suffixes or direct path matches.
 * Invariants: Matching is deterministic and path-normalized.
 */
/**
 * Normalize a relative path for consistent matching.
 * Does not access the filesystem.
 * Edge cases: Converts Windows separators to POSIX.
 * Invariants: Returned paths never contain backslashes.
 */
export function normalizeRelativePath(relPath) {
    return relPath.replace(/\\/g, "/");
}
/**
 * Detect suffix-only patterns (like .md).
 * Does not validate pattern contents.
 * Edge cases: Returns false for patterns containing '/'.
 * Invariants: Only dot-prefixed patterns are treated as suffixes.
 */
function isSuffixPattern(pattern) {
    return pattern.startsWith(".") && !pattern.includes("/");
}
/**
 * Match a file path against a simple allowlist pattern.
 * Does not expand glob wildcards.
 * Edge cases: Matches suffix patterns and exact paths.
 * Invariants: Matching uses normalized path separators.
 */
function matchesAllowlistPattern(relPath, pattern) {
    const normalizedPath = normalizeRelativePath(relPath);
    const normalizedPattern = normalizeRelativePath(pattern);
    if (isSuffixPattern(normalizedPattern)) {
        return normalizedPath.endsWith(normalizedPattern);
    }
    if (normalizedPattern.includes("/")) {
        return normalizedPath === normalizedPattern;
    }
    return (normalizedPath.endsWith(`/${normalizedPattern}`)
        || normalizedPath === normalizedPattern);
}
/**
 * Build a predicate to check if a path is in the allowed set.
 * Does not mutate the evaluation or allowlist inputs.
 * Edge cases: Empty allowlists still allow explicit affected files.
 * Invariants: The predicate only allows normalized paths.
 */
export function buildAllowedPathChecker(evaluation, allowlistPatterns) {
    const allowedPaths = new Set(evaluation.affectedFiles.map(normalizeRelativePath));
    const normalizedAllowlist = allowlistPatterns.map((pattern) => normalizeRelativePath(pattern));
    return (relPath) => {
        const normalized = normalizeRelativePath(relPath);
        // Fallback: If Story agent is used (no affectedFiles) and no strict allowlist is set, allow to maintain core functionality.
        if (allowedPaths.size === 0 && normalizedAllowlist.length === 0) {
            return true;
        }
        if (allowedPaths.has(normalized))
            return true;
        return normalizedAllowlist.some((pattern) => matchesAllowlistPattern(normalized, pattern));
    };
}
//# sourceMappingURL=allowlist.js.map