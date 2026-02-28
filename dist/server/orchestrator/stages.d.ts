/**
 * Purpose: Centralize execution stage strings for Phase 5.
 * High-level behavior: Exports canonical stage strings and validators.
 * Assumptions: Stage strings must match the Phase 4 UI text.
 * Invariants: Stage values remain stable across versions.
 */
export declare const STAGE_ACQUIRE = "Acquiring file locks...";
export declare const STAGE_SYNC = "Syncing project files to sandbox...";
export declare const STAGE_SPAWN = "Spawning sandbox...";
export declare const STAGE_WORKING = "Agent is working...";
export declare const STAGE_EXTRACT = "Extracting changes...";
export declare const STAGE_APPLY = "Applying changes to codebase...";
/**
 * Validate whether a stage string is safe to forward to the UI.
 * Does not mutate input values.
 * Edge cases: Unknown stages return false.
 * Invariants: Only known stage strings are allowed.
 */
export declare function isAllowedRemoteStage(stage: string): boolean;
