/**
 * Purpose: Define the client/server protocol and validation schemas.
 * High-level behavior: Exposes Zod schemas and type-safe message parsing.
 * Assumptions: Messages are JSON objects with { type, payload } shape.
 * Invariants: Invalid messages are rejected and never thrown.
 */
import { z } from "zod";
export declare const FileChangeSchema: z.ZodObject<{
    path: z.ZodString;
    diff: z.ZodString;
    linesAdded: z.ZodNumber;
    linesRemoved: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    path: string;
    diff: string;
    linesAdded: number;
    linesRemoved: number;
}, {
    path: string;
    diff: string;
    linesAdded: number;
    linesRemoved: number;
}>;
export type FileChange = z.infer<typeof FileChangeSchema>;
export declare const ClientMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"join">;
    payload: z.ZodObject<{
        partyCode: z.ZodString;
        username: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        partyCode: string;
        username: string;
    }, {
        partyCode: string;
        username: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "join";
    payload: {
        partyCode: string;
        username: string;
    };
}, {
    type: "join";
    payload: {
        partyCode: string;
        username: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt-submit">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        content: z.ZodString;
        scope: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        content: string;
        scope?: string[] | undefined;
    }, {
        promptId: string;
        content: string;
        scope?: string[] | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "prompt-submit";
    payload: {
        promptId: string;
        content: string;
        scope?: string[] | undefined;
    };
}, {
    type: "prompt-submit";
    payload: {
        promptId: string;
        content: string;
        scope?: string[] | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"host-verdict">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        verdict: z.ZodEnum<["approve", "deny"]>;
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        verdict: "approve" | "deny";
        reason?: string | undefined;
    }, {
        promptId: string;
        verdict: "approve" | "deny";
        reason?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "host-verdict";
    payload: {
        promptId: string;
        verdict: "approve" | "deny";
        reason?: string | undefined;
    };
}, {
    type: "host-verdict";
    payload: {
        promptId: string;
        verdict: "approve" | "deny";
        reason?: string | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"status-update">;
    payload: z.ZodObject<{
        status: z.ZodEnum<["typing", "idle"]>;
    }, "strip", z.ZodTypeAny, {
        status: "typing" | "idle";
    }, {
        status: "typing" | "idle";
    }>;
}, "strip", z.ZodTypeAny, {
    type: "status-update";
    payload: {
        status: "typing" | "idle";
    };
}, {
    type: "status-update";
    payload: {
        status: "typing" | "idle";
    };
}>]>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export declare const ServerMessageSchema: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
    type: z.ZodLiteral<"join-ack">;
    payload: z.ZodObject<{
        partyCode: z.ZodString;
        members: z.ZodArray<z.ZodString, "many">;
        isHost: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        partyCode: string;
        members: string[];
        isHost: boolean;
    }, {
        partyCode: string;
        members: string[];
        isHost: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "join-ack";
    payload: {
        partyCode: string;
        members: string[];
        isHost: boolean;
    };
}, {
    type: "join-ack";
    payload: {
        partyCode: string;
        members: string[];
        isHost: boolean;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"member-joined">;
    payload: z.ZodObject<{
        username: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        username: string;
    }, {
        username: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "member-joined";
    payload: {
        username: string;
    };
}, {
    type: "member-joined";
    payload: {
        username: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"member-left">;
    payload: z.ZodObject<{
        username: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        username: string;
    }, {
        username: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "member-left";
    payload: {
        username: string;
    };
}, {
    type: "member-left";
    payload: {
        username: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt-queued">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        position: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        position: number;
    }, {
        promptId: string;
        position: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "prompt-queued";
    payload: {
        promptId: string;
        position: number;
    };
}, {
    type: "prompt-queued";
    payload: {
        promptId: string;
        position: number;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt-greenlit">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        reasoning: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        reasoning: string;
    }, {
        promptId: string;
        reasoning: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "prompt-greenlit";
    payload: {
        promptId: string;
        reasoning: string;
    };
}, {
    type: "prompt-greenlit";
    payload: {
        promptId: string;
        reasoning: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt-redlit">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        reasoning: z.ZodString;
        conflicts: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        reasoning: string;
        conflicts: string[];
    }, {
        promptId: string;
        reasoning: string;
        conflicts: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "prompt-redlit";
    payload: {
        promptId: string;
        reasoning: string;
        conflicts: string[];
    };
}, {
    type: "prompt-redlit";
    payload: {
        promptId: string;
        reasoning: string;
        conflicts: string[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt-approved">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
    }, {
        promptId: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "prompt-approved";
    payload: {
        promptId: string;
    };
}, {
    type: "prompt-approved";
    payload: {
        promptId: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"prompt-denied">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        reason: string;
    }, {
        promptId: string;
        reason: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "prompt-denied";
    payload: {
        promptId: string;
        reason: string;
    };
}, {
    type: "prompt-denied";
    payload: {
        promptId: string;
        reason: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"host-review-request">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        username: z.ZodString;
        content: z.ZodString;
        reasoning: z.ZodString;
        conflicts: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        username: string;
        promptId: string;
        content: string;
        reasoning: string;
        conflicts: string[];
    }, {
        username: string;
        promptId: string;
        content: string;
        reasoning: string;
        conflicts: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    type: "host-review-request";
    payload: {
        username: string;
        promptId: string;
        content: string;
        reasoning: string;
        conflicts: string[];
    };
}, {
    type: "host-review-request";
    payload: {
        username: string;
        promptId: string;
        content: string;
        reasoning: string;
        conflicts: string[];
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"activity">;
    payload: z.ZodObject<{
        username: z.ZodString;
        event: z.ZodString;
        timestamp: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        username: string;
        event: string;
        timestamp: number;
    }, {
        username: string;
        event: string;
        timestamp: number;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "activity";
    payload: {
        username: string;
        event: string;
        timestamp: number;
    };
}, {
    type: "activity";
    payload: {
        username: string;
        event: string;
        timestamp: number;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    payload: z.ZodObject<{
        message: z.ZodString;
        code: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "error";
    payload: {
        code: string;
        message: string;
    };
}, {
    type: "error";
    payload: {
        code: string;
        message: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"member-status">;
    payload: z.ZodObject<{
        username: z.ZodString;
        status: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        status: string;
        username: string;
    }, {
        status: string;
        username: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "member-status";
    payload: {
        status: string;
        username: string;
    };
}, {
    type: "member-status";
    payload: {
        status: string;
        username: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"execution-queued">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        reason: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        reason: string;
    }, {
        promptId: string;
        reason: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "execution-queued";
    payload: {
        promptId: string;
        reason: string;
    };
}, {
    type: "execution-queued";
    payload: {
        promptId: string;
        reason: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"execution-update">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        stage: z.ZodString;
        detail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        stage: string;
        detail?: string | undefined;
    }, {
        promptId: string;
        stage: string;
        detail?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "execution-update";
    payload: {
        promptId: string;
        stage: string;
        detail?: string | undefined;
    };
}, {
    type: "execution-update";
    payload: {
        promptId: string;
        stage: string;
        detail?: string | undefined;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"execution-complete">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        files: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            diff: z.ZodString;
            linesAdded: z.ZodNumber;
            linesRemoved: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }, {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }>, "many">;
        summary: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    }, {
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "execution-complete";
    payload: {
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    };
}, {
    type: "execution-complete";
    payload: {
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"system-status">;
    payload: z.ZodObject<{
        greenlightAvailable: z.ZodBoolean;
        executionBackendAvailable: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        greenlightAvailable: boolean;
        executionBackendAvailable: boolean;
    }, {
        greenlightAvailable: boolean;
        executionBackendAvailable: boolean;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "system-status";
    payload: {
        greenlightAvailable: boolean;
        executionBackendAvailable: boolean;
    };
}, {
    type: "system-status";
    payload: {
        greenlightAvailable: boolean;
        executionBackendAvailable: boolean;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"sandbox-status">;
    payload: z.ZodObject<{
        promptId: z.ZodString;
        sandboxId: z.ZodString;
        status: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        status: string;
        promptId: string;
        sandboxId: string;
    }, {
        status: string;
        promptId: string;
        sandboxId: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "sandbox-status";
    payload: {
        status: string;
        promptId: string;
        sandboxId: string;
    };
}, {
    type: "sandbox-status";
    payload: {
        status: string;
        promptId: string;
        sandboxId: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"member-execution-update">;
    payload: z.ZodObject<{
        username: z.ZodString;
        promptId: z.ZodString;
        stage: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        username: string;
        promptId: string;
        stage: string;
    }, {
        username: string;
        promptId: string;
        stage: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "member-execution-update";
    payload: {
        username: string;
        promptId: string;
        stage: string;
    };
}, {
    type: "member-execution-update";
    payload: {
        username: string;
        promptId: string;
        stage: string;
    };
}>, z.ZodObject<{
    type: z.ZodLiteral<"member-execution-complete">;
    payload: z.ZodObject<{
        username: z.ZodString;
        promptId: z.ZodString;
        files: z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            diff: z.ZodString;
            linesAdded: z.ZodNumber;
            linesRemoved: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }, {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }>, "many">;
        summary: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        username: string;
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    }, {
        username: string;
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "member-execution-complete";
    payload: {
        username: string;
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    };
}, {
    type: "member-execution-complete";
    payload: {
        username: string;
        promptId: string;
        files: {
            path: string;
            diff: string;
            linesAdded: number;
            linesRemoved: number;
        }[];
        summary: string;
    };
}>]>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export declare function parseClientMessage(data: unknown): ClientMessage | null;
export declare function parseServerMessage(data: unknown): ServerMessage | null;
