/**
 * Purpose: Normalize and generate file diffs for execution results.
 * High-level behavior: Computes line counts and builds unified diffs.
 * Assumptions: Inputs are UTF-8 file contents, paths are relative.
 * Invariants: linesAdded/linesRemoved reflect the diff payload.
 */
/**
 * Split content into lines without stripping empty tail lines.
 * Does not normalize line endings.
 */
function splitLines(content) {
    if (content === "")
        return [];
    return content.split("\n");
}
/**
 * Count added/removed lines in a unified diff string.
 * Ignores diff metadata lines (---, +++).
 */
export function countDiffLines(diff) {
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---"))
            continue;
        if (line.startsWith("+"))
            linesAdded += 1;
        if (line.startsWith("-"))
            linesRemoved += 1;
    }
    return { linesAdded, linesRemoved };
}
/**
 * Build a full-file unified diff (replace all lines).
 * Does not attempt a minimal diff; it is deterministic.
 */
export function buildFullDiff(relPath, before, after) {
    if (before === after)
        return null;
    const beforeLines = splitLines(before);
    const afterLines = splitLines(after);
    const diffLines = [
        `--- a/${relPath}`,
        `+++ b/${relPath}`,
        `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
        ...beforeLines.map((line) => `-${line}`),
        ...afterLines.map((line) => `+${line}`),
    ];
    const diff = diffLines.join("\n");
    return {
        path: relPath,
        diff,
        linesAdded: afterLines.length,
        linesRemoved: beforeLines.length,
    };
}
/**
 * Normalize changes that only include path+diff into full FileChange.
 * Preserves the diff payload while recomputing line counts.
 */
export function normalizeDiffChanges(changes) {
    return changes.map((change) => {
        const counts = countDiffLines(change.diff);
        return {
            path: change.path,
            diff: change.diff,
            linesAdded: counts.linesAdded,
            linesRemoved: counts.linesRemoved,
        };
    });
}
//# sourceMappingURL=result.js.map