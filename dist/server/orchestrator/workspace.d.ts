/**
 * Purpose: Provide workspace file operations for orchestrator execution.
 * High-level behavior: Loads story text, builds diffs, and applies updates.
 * Assumptions: The project root is a writable local filesystem path.
 * Invariants: All writes stay within the project root.
 */
import type { FileChange } from "./result.js";
export declare class WorkspaceFiles {
    private projectRoot;
    private gitClient;
    private tempCounter;
    /**
     * Create a workspace file helper for the given root.
     * Does not validate the filesystem layout.
     * Edge cases: Accepts non-git directories for diffing.
     * Invariants: gitClient always uses projectRoot as baseDir.
     */
    constructor(projectRoot: string);
    /**
     * Load STORY.md if present, otherwise return a default story.
     * Does not throw on read failures.
     * Edge cases: Missing file returns the default string.
     * Invariants: Story content is always non-empty.
     */
    loadStory(defaultStory: string, log: (message: string) => void): string;
    /**
     * Build file changes using git diff --no-index.
     * Does not modify files on disk.
     * Edge cases: Missing originals fall back to current file contents.
     * Invariants: Returned diffs match the updated content map.
     */
    buildFileChanges(originals: Record<string, string>, updated: Record<string, string>): Promise<FileChange[]>;
    /**
     * Apply file updates to the local project.
     * Does not write outside the project root.
     * Edge cases: Creates missing directories as needed.
     * Invariants: Writes occur atomically per file.
     */
    applyChanges(updatedFiles: Record<string, string>): Promise<void>;
    /**
     * Read the original file contents when available.
     * Does not throw when files are missing.
     * Edge cases: Missing files return an empty string.
     * Invariants: Returns the original snapshot when provided.
     */
    private readFileBeforeChange;
    /**
     * Build a git-style diff for a single file.
     * Does not reuse temp files across calls.
     * Edge cases: Returns null when git produces no diff.
     * Invariants: Temp files are removed after diffing.
     */
    private buildGitDiff;
    /**
     * Normalize diff paths to use forward slashes.
     * Does not access the filesystem.
     * Edge cases: Returns empty strings unchanged.
     * Invariants: Output never contains backslashes.
     */
    private normalizeDiffPath;
    /**
     * Replace temp file labels in a diff with the target relative path.
     * Does not alter diff hunk content.
     * Edge cases: Leaves diff unchanged when headers are missing.
     * Invariants: Header paths always match the provided relPath.
     */
    private replaceDiffLabels;
    /**
     * Build the temp diff directory path and ensure it exists.
     * Does not remove existing files.
     * Edge cases: Creates nested directories when absent.
     * Invariants: Directory exists after this call.
     */
    private getTempDiffDir;
    /**
     * Build a unique temp file base name.
     * Does not create files on disk.
     * Edge cases: Sanitizes path separators and spaces.
     * Invariants: Each call returns a unique suffix.
     */
    private buildTempBaseName;
    /**
     * Write content to a temp file path.
     * Does not attempt atomic renames.
     * Edge cases: Overwrites existing temp files.
     * Invariants: Writes use UTF-8 encoding.
     */
    private writeTempFile;
    /**
     * Remove a temp file if it exists.
     * Does not throw on missing files.
     * Edge cases: Ignores removal errors.
     * Invariants: No exceptions propagate from cleanup.
     */
    private removeTempFile;
    /**
     * Increment the temp file counter.
     * Does not depend on external randomness.
     * Edge cases: Counter overflow is not expected.
     * Invariants: Returned values are monotonically increasing.
     */
    private nextTempSuffix;
    /**
     * Write a file atomically via a temp file + rename.
     * Does not preserve file permissions or metadata.
     * Edge cases: Attempts cleanup on rename failures.
     * Invariants: Target file is fully replaced on success.
     */
    private writeFileAtomic;
    /**
     * Resolve a relative path and prevent root escape.
     * Does not create directories or touch the filesystem.
     * Edge cases: Throws if the path escapes the project root.
     * Invariants: Returned paths always start with projectRoot.
     */
    private safeResolve;
    /**
     * Ensure a directory exists by creating it recursively.
     * Does not remove existing files.
     * Edge cases: Handles nested directory creation.
     * Invariants: Directory exists after this call.
     */
    private ensureDir;
}
