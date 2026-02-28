/**
 * Purpose: Provide workspace file operations for orchestrator execution.
 * High-level behavior: Loads story text, builds diffs, and applies updates.
 * Assumptions: The project root is a writable local filesystem path.
 * Invariants: All writes stay within the project root.
 */

import fs from "node:fs";
import path from "node:path";
import simpleGit from "simple-git";
import type { FileChange } from "./result.js";
import { countDiffLines } from "./result.js";

const TEMP_DIR_NAME = ".overmind";
const TEMP_DIFF_DIR = "diff";

export class WorkspaceFiles {
    private projectRoot: string;
    private gitClient: ReturnType<typeof simpleGit>;
    private tempCounter = 0;

    /**
     * Create a workspace file helper for the given root.
     * Does not validate the filesystem layout.
     * Edge cases: Accepts non-git directories for diffing.
     * Invariants: gitClient always uses projectRoot as baseDir.
     */
    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.gitClient = simpleGit({ baseDir: projectRoot });
    }

    /**
     * Load STORY.md if present, otherwise return a default story.
     * Does not throw on read failures.
     * Edge cases: Missing file returns the default string.
     * Invariants: Story content is always non-empty.
     */
    loadStory(defaultStory: string, log: (message: string) => void): string {
        const storyPath = path.join(this.projectRoot, "STORY.md");
        try {
            if (!fs.existsSync(storyPath)) return defaultStory;
            const content = fs.readFileSync(storyPath, "utf-8");
            return content.trim() || defaultStory;
        } catch (error) {
            log(`story read failed: ${String(error)}`);
            return defaultStory;
        }
    }

    /**
     * Build file changes using git diff --no-index.
     * Does not modify files on disk.
     * Edge cases: Missing originals fall back to current file contents.
     * Invariants: Returned diffs match the updated content map.
     */
    async buildFileChanges(
        originals: Record<string, string>,
        updated: Record<string, string>
    ): Promise<FileChange[]> {
        const changes: FileChange[] = [];

        for (const [relPath, after] of Object.entries(updated)) {
            const before = this.readFileBeforeChange(relPath, originals);
            if (before === after) continue;
            const diff = await this.buildGitDiff(relPath, before, after);
            if (!diff) continue;
            const counts = countDiffLines(diff);
            changes.push({
                path: relPath,
                diff,
                linesAdded: counts.linesAdded,
                linesRemoved: counts.linesRemoved,
            });
        }

        return changes;
    }

    /**
     * Apply file updates to the local project.
     * Does not write outside the project root.
     * Edge cases: Creates missing directories as needed.
     * Invariants: Writes occur atomically per file.
     */
    async applyChanges(updatedFiles: Record<string, string>): Promise<void> {
        for (const [relPath, content] of Object.entries(updatedFiles)) {
            const absPath = this.safeResolve(this.projectRoot, relPath);
            this.ensureDir(path.dirname(absPath));
            this.writeFileAtomic(absPath, content);
        }
    }

    /**
     * Read the original file contents when available.
     * Does not throw when files are missing.
     * Edge cases: Missing files return an empty string.
     * Invariants: Returns the original snapshot when provided.
     */
    private readFileBeforeChange(
        relPath: string,
        originals: Record<string, string>
    ): string {
        if (Object.prototype.hasOwnProperty.call(originals, relPath)) {
            return originals[relPath] ?? "";
        }

        const absPath = this.safeResolve(this.projectRoot, relPath);
        if (!fs.existsSync(absPath)) return "";
        return fs.readFileSync(absPath, "utf-8");
    }

    /**
     * Build a git-style diff for a single file.
     * Does not reuse temp files across calls.
     * Edge cases: Returns null when git produces no diff.
     * Invariants: Temp files are removed after diffing.
     */
    private async buildGitDiff(
        relPath: string,
        before: string,
        after: string
    ): Promise<string | null> {
        const tempDir = this.getTempDiffDir();
        const fileBase = this.buildTempBaseName(relPath);
        const beforePath = path.join(tempDir, `${fileBase}.before`);
        const afterPath = path.join(tempDir, `${fileBase}.after`);

        this.writeTempFile(beforePath, before);
        this.writeTempFile(afterPath, after);

        try {
            const diff = await this.gitClient.diff([
                "--no-index",
                "--label",
                `a/${relPath}`,
                "--label",
                `b/${relPath}`,
                beforePath,
                afterPath,
            ]);
            return diff.trim() ? diff : null;
        } finally {
            this.removeTempFile(beforePath);
            this.removeTempFile(afterPath);
        }
    }

    /**
     * Build the temp diff directory path and ensure it exists.
     * Does not remove existing files.
     * Edge cases: Creates nested directories when absent.
     * Invariants: Directory exists after this call.
     */
    private getTempDiffDir(): string {
        const tempRoot = path.join(this.projectRoot, TEMP_DIR_NAME);
        const diffDir = path.join(tempRoot, TEMP_DIFF_DIR);
        this.ensureDir(diffDir);
        return diffDir;
    }

    /**
     * Build a unique temp file base name.
     * Does not create files on disk.
     * Edge cases: Sanitizes path separators and spaces.
     * Invariants: Each call returns a unique suffix.
     */
    private buildTempBaseName(relPath: string): string {
        const sanitized = relPath.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const suffix = this.nextTempSuffix();
        return `${sanitized}-${suffix}`;
    }

    /**
     * Write content to a temp file path.
     * Does not attempt atomic renames.
     * Edge cases: Overwrites existing temp files.
     * Invariants: Writes use UTF-8 encoding.
     */
    private writeTempFile(filePath: string, content: string): void {
        fs.writeFileSync(filePath, content, "utf-8");
    }

    /**
     * Remove a temp file if it exists.
     * Does not throw on missing files.
     * Edge cases: Ignores removal errors.
     * Invariants: No exceptions propagate from cleanup.
     */
    private removeTempFile(filePath: string): void {
        try {
            fs.rmSync(filePath, { force: true });
        } catch {
            // Cleanup failures must not crash execution.
        }
    }

    /**
     * Increment the temp file counter.
     * Does not depend on external randomness.
     * Edge cases: Counter overflow is not expected.
     * Invariants: Returned values are monotonically increasing.
     */
    private nextTempSuffix(): number {
        this.tempCounter += 1;
        return this.tempCounter;
    }

    /**
     * Write a file atomically via a temp file + rename.
     * Does not preserve file permissions or metadata.
     * Edge cases: Attempts cleanup on rename failures.
     * Invariants: Target file is fully replaced on success.
     */
    private writeFileAtomic(filePath: string, content: string): void {
        const tempPath = `${filePath}.overmind-${this.nextTempSuffix()}`;
        try {
            fs.writeFileSync(tempPath, content, "utf-8");
            fs.renameSync(tempPath, filePath);
        } catch (error) {
            this.removeTempFile(tempPath);
            throw error;
        }
    }

    /**
     * Resolve a relative path and prevent root escape.
     * Does not create directories or touch the filesystem.
     * Edge cases: Throws if the path escapes the project root.
     * Invariants: Returned paths always start with projectRoot.
     */
    private safeResolve(projectRoot: string, relPath: string): string {
        const absolute = path.resolve(projectRoot, relPath);
        if (!absolute.startsWith(projectRoot)) {
            throw new Error("Path escapes project root");
        }
        return absolute;
    }

    /**
     * Ensure a directory exists by creating it recursively.
     * Does not remove existing files.
     * Edge cases: Handles nested directory creation.
     * Invariants: Directory exists after this call.
     */
    private ensureDir(dirPath: string): void {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
}
