/**
 * Purpose: Centralize execution stage strings for Phase 5.
 * High-level behavior: Exports canonical stage strings and validators.
 * Assumptions: Stage strings must match the Phase 4 UI text.
 * Invariants: Stage values remain stable across versions.
 */
export const STAGE_ACQUIRE = "Acquiring file locks...";
export const STAGE_SYNC = "Syncing project files to sandbox...";
export const STAGE_SPAWN = "Spawning sandbox...";
export const STAGE_WORKING = "Agent is working...";
export const STAGE_EXTRACT = "Extracting changes...";
export const STAGE_APPLY = "Applying changes to codebase...";
const REMOTE_STAGES = new Set([
    STAGE_SPAWN,
    STAGE_WORKING,
    STAGE_EXTRACT,
]);
/**
 * Validate whether a stage string is safe to forward to the UI.
 * Does not mutate input values.
 * Edge cases: Unknown stages return false.
 * Invariants: Only known stage strings are allowed.
 */
export function isAllowedRemoteStage(stage) {
    return REMOTE_STAGES.has(stage);
}
//# sourceMappingURL=stages.js.map