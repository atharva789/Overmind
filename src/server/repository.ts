// Purpose: Validate and compare repository identifiers during join.
// Behavior: Normalizes the incoming repository and checks expected match.
// Assumptions: The expected repository is already normalized if provided.
// Invariants: Returns deterministic error codes for invalid or mismatched
// repositories.

import { normalizeGithubRepository } from "../shared/repository.js";
import { ErrorCode } from "../shared/constants.js";
import type { ErrorCodeValue } from "../shared/constants.js";

export interface RepositoryCheckResult {
    ok: boolean;
    repository?: string;
    errorCode?: ErrorCodeValue;
    errorMessage?: string;
}

export function validateJoinRepository(
    incomingRepository: string,
    expectedRepository?: string
): RepositoryCheckResult {
    const normalizedRepository = normalizeGithubRepository(incomingRepository);
    if (!normalizedRepository) {
        return {
            ok: false,
            errorCode: ErrorCode.REPO_INVALID,
            errorMessage: "Join requires a GitHub origin repository.",
        };
    }

    if (expectedRepository && normalizedRepository !== expectedRepository) {
        const mismatchMessage =
            `Repository mismatch. Expected ${expectedRepository}.`;
        return {
            ok: false,
            errorCode: ErrorCode.REPO_MISMATCH,
            errorMessage: mismatchMessage,
        };
    }

    return { ok: true, repository: normalizedRepository };
}
