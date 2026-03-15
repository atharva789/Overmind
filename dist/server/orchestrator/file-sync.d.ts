/**
 * Purpose: Selectively pack project files for sandbox execution.
 * High-level behavior: Collects required files and reads their contents.
 * Assumptions: Paths are relative to project root and safe to read.
 * Invariants: node_modules/.git/dist/.overmind are never included.
 */
import type { EvaluationResult } from "../../shared/protocol.js";
export interface FilePack {
    files: Record<string, string>;
    originals: Record<string, string>;
    includedPaths: string[];
}
/**
 * Walk files under a directory with a depth cap.
 * Does not traverse excluded directories.
 */
export declare function walkFiles(root: string, relative: string, depth: number, onFile: (relPath: string) => void): void;
/**
 * Pack files for execution based on evaluation hints and scope.
 * Does not include the entire repository.
 */
export declare function packFiles(projectRoot: string, evaluation: EvaluationResult, alwaysSyncPatterns?: string[]): FilePack;
