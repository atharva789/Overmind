/**
 * Purpose: Define the client/server protocol and validation schemas.
 * High-level behavior: Exposes Zod schemas and type-safe message parsing.
 * Assumptions: Messages are JSON objects with { type, payload } shape.
 * Invariants: Invalid messages are rejected and never thrown.
 */

import { z } from "zod";

// ─── Shared Types ───

export const FileChangeSchema = z.object({
    path: z.string(),
    diff: z.string(),
    linesAdded: z.number(),
    linesRemoved: z.number(),
});

export type FileChange = z.infer<typeof FileChangeSchema>;

// ─── EvaluationResult ───

export const EvaluationResultSchema = z.object({
    verdict: z.enum(["greenlit", "redlit"]),
    reasoning: z.string(),
    conflicts: z.array(z.string()),
    affectedFiles: z.array(z.string()),
    executionHints: z.object({
        estimatedComplexity: z.enum(["simple", "moderate", "complex"]),
        requiresBuild: z.boolean(),
        requiresTests: z.boolean(),
        relatedContextFiles: z.array(z.string()),
    }),
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

// ─── Client → Server Messages ───

const JoinMessage = z.object({
    type: z.literal("join"),
    payload: z.object({
        partyCode: z.string(),
        username: z.string(),
    }),
});

const PromptSubmitMessage = z.object({
    type: z.literal("prompt-submit"),
    payload: z.object({
        promptId: z.string(),
        content: z.string(),
        scope: z.array(z.string()).optional(),
    }),
});

const HostVerdictMessage = z.object({
    type: z.literal("host-verdict"),
    payload: z.object({
        promptId: z.string(),
        verdict: z.enum(["approve", "deny"]),
        reason: z.string().optional(),
    }),
});

const StatusUpdateMessage = z.object({
    type: z.literal("status-update"),
    payload: z.object({
        status: z.enum(["typing", "idle"]),
    }),
});

const MergeRequestMessage = z.object({
    type: z.literal("merge-request"),
    payload: z.object({}),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
    JoinMessage,
    PromptSubmitMessage,
    HostVerdictMessage,
    StatusUpdateMessage,
    MergeRequestMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → Client Messages ───

const JoinAckMessage = z.object({
    type: z.literal("join-ack"),
    payload: z.object({
        partyCode: z.string(),
        members: z.array(z.string()),
        isHost: z.boolean(),
    }),
});

const MemberJoinedMessage = z.object({
    type: z.literal("member-joined"),
    payload: z.object({
        username: z.string(),
    }),
});

const MemberLeftMessage = z.object({
    type: z.literal("member-left"),
    payload: z.object({
        username: z.string(),
    }),
});

const PromptQueuedMessage = z.object({
    type: z.literal("prompt-queued"),
    payload: z.object({
        promptId: z.string(),
        position: z.number(),
    }),
});

const PromptGreenlitMessage = z.object({
    type: z.literal("prompt-greenlit"),
    payload: z.object({
        promptId: z.string(),
        reasoning: z.string(),
    }),
});

const PromptRedlitMessage = z.object({
    type: z.literal("prompt-redlit"),
    payload: z.object({
        promptId: z.string(),
        reasoning: z.string(),
        conflicts: z.array(z.string()),
    }),
});

const PromptApprovedMessage = z.object({
    type: z.literal("prompt-approved"),
    payload: z.object({
        promptId: z.string(),
    }),
});

const PromptDeniedMessage = z.object({
    type: z.literal("prompt-denied"),
    payload: z.object({
        promptId: z.string(),
        reason: z.string(),
    }),
});

const HostReviewRequestMessage = z.object({
    type: z.literal("host-review-request"),
    payload: z.object({
        promptId: z.string(),
        username: z.string(),
        content: z.string(),
        reasoning: z.string(),
        conflicts: z.array(z.string()),
    }),
});

const FeatureCreatedMessage = z.object({
    type: z.literal("feature-created"),
    payload: z.object({
        promptId: z.string(),
        title: z.string(),
    }),
});

const ActivityMessage = z.object({
    type: z.literal("activity"),
    payload: z.object({
        username: z.string(),
        event: z.string(),
        timestamp: z.number(),
    }),
});

const ErrorMessage = z.object({
    type: z.literal("error"),
    payload: z.object({
        message: z.string(),
        code: z.string(),
    }),
});

const MemberStatusMessage = z.object({
    type: z.literal("member-status"),
    payload: z.object({
        username: z.string(),
        status: z.string(),
    }),
});

const ExecutionQueuedMessage = z.object({
    type: z.literal("execution-queued"),
    payload: z.object({
        promptId: z.string(),
        reason: z.string(),
    }),
});

const ExecutionUpdateMessage = z.object({
    type: z.literal("execution-update"),
    payload: z.object({
        promptId: z.string(),
        stage: z.string(),
        detail: z.string().optional(),
    }),
});

const ExecutionCompleteMessage = z.object({
    type: z.literal("execution-complete"),
    payload: z.object({
        promptId: z.string(),
        files: z.array(FileChangeSchema),
        summary: z.string(),
    }),
});

const SystemStatusMessage = z.object({
    type: z.literal("system-status"),
    payload: z.object({
        executionBackendAvailable: z.boolean(),
    }),
});

const SandboxStatusMessage = z.object({
    type: z.literal("sandbox-status"),
    payload: z.object({
        promptId: z.string(),
        sandboxId: z.string(),
        status: z.string(),
    }),
});

const MemberExecutionUpdateMessage = z.object({
    type: z.literal("member-execution-update"),
    payload: z.object({
        username: z.string(),
        promptId: z.string(),
        stage: z.string(),
    }),
});

const MemberExecutionCompleteMessage = z.object({
    type: z.literal("member-execution-complete"),
    payload: z.object({
        username: z.string(),
        promptId: z.string(),
        files: z.array(FileChangeSchema),
        summary: z.string(),
    }),
});

const MergeUpdateMessage = z.object({
    type: z.literal("merge-update"),
    payload: z.object({
        stage: z.string(),
    }),
});

const MergeCompleteMessage = z.object({
    type: z.literal("merge-complete"),
    payload: z.object({
        filesResolved: z.number(),
        prUrl: z.string().optional(),
        hasLowConfidence: z.boolean(),
        branchName: z.string(),
        summary: z.string(),
    }),
});

const MergeErrorMessage = z.object({
    type: z.literal("merge-error"),
    payload: z.object({
        message: z.string(),
    }),
});

const ExecutionPlanReadyMessage = z.object({
    type: z.literal("execution-plan-ready"),
    payload: z.object({
        promptId: z.string(),
        tasks: z.array(z.object({
            taskIndex: z.number(),
            taskName: z.string(),
            taskDescription: z.string(),
        })),
    }),
});

const ExecutionAgentUpdateMessage = z.object({
    type: z.literal("execution-agent-update"),
    payload: z.object({
        promptId: z.string(),
        taskIndex: z.number(),
        taskName: z.string(),
        status: z.enum(["spawned", "working", "finished"]),
        summary: z.string().optional(),
        filesChanged: z.array(z.string()).optional(),
    }),
});

const ExecutionToolActivityMessage = z.object({
    type: z.literal("execution-tool-activity"),
    payload: z.object({
        promptId: z.string(),
        taskIndex: z.number(),
        taskName: z.string(),
        toolName: z.string(),
        phase: z.enum(["start", "result"]),
        success: z.boolean().optional(),
        outputPreview: z.string().optional(),
    }),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
    JoinAckMessage,
    MemberJoinedMessage,
    MemberLeftMessage,
    PromptQueuedMessage,
    PromptGreenlitMessage,
    PromptRedlitMessage,
    PromptApprovedMessage,
    PromptDeniedMessage,
    HostReviewRequestMessage,
    FeatureCreatedMessage,
    ActivityMessage,
    ErrorMessage,
    MemberStatusMessage,
    ExecutionQueuedMessage,
    ExecutionUpdateMessage,
    ExecutionCompleteMessage,
    SystemStatusMessage,
    SandboxStatusMessage,
    MemberExecutionUpdateMessage,
    MemberExecutionCompleteMessage,
    MergeUpdateMessage,
    MergeCompleteMessage,
    MergeErrorMessage,
    ExecutionPlanReadyMessage,
    ExecutionAgentUpdateMessage,
    ExecutionToolActivityMessage,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── Parsers (never throw, return null on invalid) ───

export function parseClientMessage(data: unknown): ClientMessage | null {
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        } catch {
            return null;
        }
    }
    const result = ClientMessageSchema.safeParse(data);
    return result.success ? result.data : null;
}

export function parseServerMessage(data: unknown): ServerMessage | null {
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        } catch {
            return null;
        }
    }
    const result = ServerMessageSchema.safeParse(data);
    return result.success ? result.data : null;
}
