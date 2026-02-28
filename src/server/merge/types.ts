/**
 * Purpose: Shared types for the merge conflict solver pipeline.
 * High-level behavior: Defines the contract between git detection,
 *   Modal inference, and GitHub PR creation. All types are serializable.
 * Assumptions: Callers validate inputs before constructing these types.
 * Invariants: Types are pure data — no runtime side effects.
 */

export type ConflictingFile = {
    path: string;
    rawContent: string; // full file content including <<<<<<< markers
};

export type FileResolution = {
    path: string;
    resolvedContent: string;
    reasoning: string;
    confidence: "high" | "medium" | "low";
    issues: string[];
};

export type MergeResolutionResult = {
    resolutions: FileResolution[];
    prTitle: string;
    prDescription: string;
    hasLowConfidence: boolean;
    branchName: string;
    prUrl?: string;
};

export type MergeConflictInput = {
    conflictingFiles: ConflictingFile[];
    storyMd: string;
    partyCode: string;
};

export type MergeExecutionEvent =
    | { type: "stage"; stage: string }
    | { type: "complete"; result: MergeResolutionResult }
    | { type: "error"; message: string };
