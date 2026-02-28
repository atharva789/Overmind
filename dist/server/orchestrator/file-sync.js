/**
 * Purpose: Selectively pack project files for sandbox execution.
 * High-level behavior: Collects required files and reads their contents.
 * Assumptions: Paths are relative to project root and safe to read.
 * Invariants: node_modules/.git/dist/.overmind are never included.
 */
import fs from "node:fs";
import path from "node:path";
import { ALWAYS_SYNC_PATTERNS } from "../../shared/constants.js";
const EXCLUDED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    ".overmind",
    "modal-bridge",
]);
const MAX_LIST_DEPTH = 3;
function isExcludedDir(name) {
    return EXCLUDED_DIRS.has(name);
}
/**
 * Normalize a path for stable matching across platforms.
 * Does not validate path existence.
 */
function normalizeRelativePath(inputPath) {
    return path.normalize(inputPath).replace(/\\/g, "/");
}
/**
 * Resolve a relative path and reject escapes above project root.
 * Does not create directories or touch the filesystem.
 */
function resolveSafePath(projectRoot, relPath) {
    const normalized = normalizeRelativePath(relPath);
    const absolute = path.resolve(projectRoot, normalized);
    if (!absolute.startsWith(projectRoot))
        return null;
    return absolute;
}
function readFileIfExists(absolutePath) {
    if (!fs.existsSync(absolutePath))
        return null;
    return fs.readFileSync(absolutePath, "utf-8");
}
/**
 * Add a file to the target set if it exists and is safe.
 * Does not read file contents.
 */
function addFileIfExists(projectRoot, relPath, target) {
    const absPath = resolveSafePath(projectRoot, relPath);
    if (!absPath)
        return;
    if (!fs.existsSync(absPath))
        return;
    target.add(normalizeRelativePath(relPath));
}
function isSuffixPattern(pattern) {
    return pattern.startsWith(".") && !pattern.includes("/");
}
/**
 * Match a simple suffix or direct path pattern against a file path.
 * Does not support globs beyond basic suffix handling.
 */
function matchesPattern(relPath, pattern) {
    if (isSuffixPattern(pattern)) {
        return relPath.endsWith(pattern);
    }
    if (pattern.includes("/")) {
        return normalizeRelativePath(relPath)
            === normalizeRelativePath(pattern);
    }
    return relPath.endsWith(`/${pattern}`) || relPath === pattern;
}
/**
 * Walk files under a directory with a depth cap.
 * Does not traverse excluded directories.
 */
function walkFiles(root, relative, depth, onFile) {
    if (depth > MAX_LIST_DEPTH)
        return;
    const absolute = path.join(root, relative);
    const entries = fs.readdirSync(absolute, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (isExcludedDir(entry.name))
                continue;
            walkFiles(root, path.join(relative, entry.name), depth + 1, onFile);
        }
        else if (entry.isFile()) {
            const relPath = normalizeRelativePath(path.join(relative, entry.name));
            onFile(relPath);
        }
    }
}
/**
 * Collect files that match always-sync patterns.
 * Does not include excluded directories.
 */
function collectPatternMatches(projectRoot, patterns, target) {
    const suffixPatterns = patterns.filter(isSuffixPattern);
    const directPatterns = patterns.filter((p) => !isSuffixPattern(p));
    for (const pattern of directPatterns) {
        addFileIfExists(projectRoot, pattern, target);
    }
    if (suffixPatterns.length === 0)
        return;
    walkFiles(projectRoot, ".", 0, (relPath) => {
        if (suffixPatterns.some((p) => matchesPattern(relPath, p))) {
            target.add(relPath);
        }
    });
}
/**
 * Build the required file list for a given evaluation scope.
 * Does not include files outside explicit scope and patterns.
 */
function collectRequiredFiles(projectRoot, evaluation, alwaysSyncPatterns) {
    const required = new Set();
    addFileIfExists(projectRoot, "context.md", required);
    addFileIfExists(projectRoot, "package.json", required);
    addFileIfExists(projectRoot, "tsconfig.json", required);
    for (const relPath of evaluation.affectedFiles) {
        addFileIfExists(projectRoot, relPath, required);
    }
    for (const relPath of evaluation.executionHints.relatedContextFiles) {
        addFileIfExists(projectRoot, relPath, required);
    }
    collectPatternMatches(projectRoot, alwaysSyncPatterns, required);
    return required;
}
/**
 * Read file contents for required and affected files.
 * Does not include files that fail safety checks.
 */
function buildFileMaps(projectRoot, required, affectedFiles) {
    const files = {};
    const originals = {};
    const includedPaths = [...required].sort();
    for (const relPath of includedPaths) {
        const absPath = resolveSafePath(projectRoot, relPath);
        if (!absPath)
            continue;
        const content = readFileIfExists(absPath);
        if (content === null)
            continue;
        files[relPath] = content;
    }
    for (const relPath of affectedFiles) {
        const absPath = resolveSafePath(projectRoot, relPath);
        if (!absPath)
            continue;
        const content = readFileIfExists(absPath);
        if (content === null)
            continue;
        originals[relPath] = content;
    }
    return { files, originals, includedPaths };
}
/**
 * Pack files for execution based on evaluation hints and scope.
 * Does not include the entire repository.
 */
export function packFiles(projectRoot, evaluation, alwaysSyncPatterns = ALWAYS_SYNC_PATTERNS) {
    const required = collectRequiredFiles(projectRoot, evaluation, alwaysSyncPatterns);
    return buildFileMaps(projectRoot, required, evaluation.affectedFiles);
}
//# sourceMappingURL=file-sync.js.map