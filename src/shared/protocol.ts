import { z } from "zod";

// ─── Client → Server Messages ─────────────────────────────────────────────────

const JoinSchema = z.object({
  type: z.literal("join"),
  payload: z.object({
    partyCode: z.string(),
    username: z.string(),
  }),
});

const PromptSubmitSchema = z.object({
  type: z.literal("prompt-submit"),
  payload: z.object({
    promptId: z.string(),
    content: z.string(),
    scope: z.array(z.string()).optional(),
  }),
});

const HostVerdictSchema = z.object({
  type: z.literal("host-verdict"),
  payload: z.object({
    promptId: z.string(),
    verdict: z.enum(["approve", "deny"]),
    reason: z.string().optional(),
  }),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  JoinSchema,
  PromptSubmitSchema,
  HostVerdictSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Server → Client Messages ─────────────────────────────────────────────────

const JoinAckSchema = z.object({
  type: z.literal("join-ack"),
  payload: z.object({
    partyCode: z.string(),
    members: z.array(z.string()),
    isHost: z.boolean(),
  }),
});

const MemberJoinedSchema = z.object({
  type: z.literal("member-joined"),
  payload: z.object({
    username: z.string(),
  }),
});

const MemberLeftSchema = z.object({
  type: z.literal("member-left"),
  payload: z.object({
    username: z.string(),
  }),
});

const PromptQueuedSchema = z.object({
  type: z.literal("prompt-queued"),
  payload: z.object({
    promptId: z.string(),
    position: z.number(),
  }),
});

const PromptGreenlitSchema = z.object({
  type: z.literal("prompt-greenlit"),
  payload: z.object({
    promptId: z.string(),
    reasoning: z.string(),
  }),
});

const PromptRedlitSchema = z.object({
  type: z.literal("prompt-redlit"),
  payload: z.object({
    promptId: z.string(),
    reasoning: z.string(),
    conflicts: z.array(z.string()),
  }),
});

const PromptApprovedSchema = z.object({
  type: z.literal("prompt-approved"),
  payload: z.object({
    promptId: z.string(),
  }),
});

const PromptDeniedSchema = z.object({
  type: z.literal("prompt-denied"),
  payload: z.object({
    promptId: z.string(),
    reason: z.string(),
  }),
});

const HostReviewRequestSchema = z.object({
  type: z.literal("host-review-request"),
  payload: z.object({
    promptId: z.string(),
    username: z.string(),
    content: z.string(),
    reasoning: z.string(),
    conflicts: z.array(z.string()),
  }),
});

const ActivitySchema = z.object({
  type: z.literal("activity"),
  payload: z.object({
    username: z.string(),
    event: z.string(),
    timestamp: z.number(),
  }),
});

const ErrorSchema = z.object({
  type: z.literal("error"),
  payload: z.object({
    message: z.string(),
    code: z.string(),
  }),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  JoinAckSchema,
  MemberJoinedSchema,
  MemberLeftSchema,
  PromptQueuedSchema,
  PromptGreenlitSchema,
  PromptRedlitSchema,
  PromptApprovedSchema,
  PromptDeniedSchema,
  HostReviewRequestSchema,
  ActivitySchema,
  ErrorSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ─── Parse Helpers ─────────────────────────────────────────────────────────────

export function parseClientMessage(raw: unknown): ClientMessage | null {
  try {
    const parsed =
      typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = ClientMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
  try {
    const parsed =
      typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = ServerMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
