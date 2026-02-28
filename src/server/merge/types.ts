/**
 * Purpose: TypeScript types for the merge conflict solver module.
 * High-level behavior: Defines data shapes for conflict detection,
 *   AI resolution, and GitHub PR creation.
 * Assumptions: Conflict markers follow standard git format.
 * Invariants: FileResolution.resolvedContent never contains
 *   conflict marker strings.
 */

// A single file that has git conflict markers in it
export type ConflictingFile = {
    path: string;           // e.g. "src/auth/login.ts"
    rawContent: string;     // full file content including <<<<<<< markers
    conflicts: ConflictBlock[];  // parsed individual conflict blocks
};

// One conflict block within a file (there may be multiple per file)
export type ConflictBlock = {
    ours: string;       // code between <<<<<<< and =======
    theirs: string;     // code between ======= and >>>>>>>
    startLine: number;  // line number where <<<<<<< appears
    endLine: number;    // line number where >>>>>>> appears
};

// What the Gemini agent returns for one conflicting file
export type FileResolution = {
    path: string;
    resolvedContent: string;  // full file content, no conflict markers
    reasoning: string;        // 1-3 sentences explaining decisions made
    confidence: "high" | "medium" | "low";
    issuesFound: string[];    // any concerns the agent flagged
};

// The full result of running the merge conflict solver
export type MergeResolutionResult = {
    resolutions: FileResolution[];
    prTitle: string;
    prDescription: string;    // full markdown, ready to post to GitHub
    hasLowConfidence: boolean; // true if ANY file had low confidence
    branchName: string;        // e.g. "overmind/merge-resolved-1234567890"
    prUrl?: string;            // populated after PR is opened
};

// Input to the merge conflict solver
export type MergeConflictInput = {
    conflictingFiles: ConflictingFile[];  // pass [] to auto-detect
    storyMd: string;    // full contents of story.md
    partyCode: string;  // e.g. "AXKM", used for branch naming and logs
};
