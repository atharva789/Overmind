/**
 * Purpose: Root TUI component that owns all client-side state
 *          and routes WebSocket messages into reducer actions.
 * High-level behavior: Uses a useReducer with a unified
 *          `history: HistoryEntry[]` array. Every event
 *          (prompts, statuses, agent streams, completions)
 *          appends to history so the user sees a scrollable
 *          chat log instead of ephemeral replacements.
 * Assumptions: Connection and Session are injected as props.
 * Invariants: State is never mutated; all updates produce new
 *             objects via spread. Prompt content is never
 *             broadcast to non-host members.
 */

import React, { useReducer, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Connection } from "../connection.js";
import type { Session } from "../session.js";
import type { ServerMessage, FileChange } from "../../shared/protocol.js";
import StatusBar from "./StatusBar.js";
import PartyPanel from "./PartyPanel.js";
import type { MemberView } from "./PartyPanel.js";
import HistoryView from "./HistoryView.js";
import type { HistoryEntry } from "./types/history.js";
import ActivityFeed from "./ActivityFeed.js";
import type { ActivityEvent } from "./ActivityFeed.js";
import PromptInput from "./PromptInput.js";
import ReviewPanel from "./ReviewPanel.js";
import type { ReviewRequest } from "./ReviewPanel.js";
import ExecutionView from "./ExecutionView.js";
import type { ExecutionState } from "./ExecutionView.js";

// ─── State ───

interface AppState {
    readonly myUsername: string;
    readonly members: readonly MemberView[];
    readonly history: readonly HistoryEntry[];
    readonly activePromptId: string | null;
    readonly expandedEntryId: string | null;
    readonly events: readonly ActivityEvent[];
    readonly connectionStatus:
        | "connected"
        | "reconnecting"
        | "disconnected";
    readonly isHost: boolean;
    readonly partyCode: string;
    readonly reviewQueue: readonly ReviewRequest[];
    readonly memberExecutions: Readonly<
        Record<string, ExecutionState>
    >;
    readonly viewingMember: string | null;
    readonly executionBackendAvailable: boolean;
    readonly errorMessage: string | null;
    readonly partyEnded: boolean;
    readonly mergeInProgress: boolean;
    readonly mergeStage: string | null;
    readonly scrollOffset: number;
}

const initialState: AppState = {
    myUsername: "",
    members: [],
    history: [],
    activePromptId: null,
    expandedEntryId: null,
    scrollOffset: 0,
    events: [],
    connectionStatus: "disconnected",
    isHost: false,
    partyCode: "",
    reviewQueue: [],
    memberExecutions: {},
    viewingMember: null,
    executionBackendAvailable: true,
    errorMessage: null,
    partyEnded: false,
    mergeInProgress: false,
    mergeStage: null,
};

// ─── Actions ───

type Action =
    | { type: "CONNECTED" }
    | { type: "DISCONNECTED" }
    | { type: "RECONNECTING" }
    | {
          type: "JOIN_ACK";
          partyCode: string;
          members: string[];
          isHost: boolean;
          myUsername: string;
      }
    | { type: "MEMBER_JOINED"; username: string }
    | { type: "MEMBER_LEFT"; username: string }
    | { type: "MEMBER_STATUS"; username: string; status: string }
    | { type: "PROMPT_QUEUED"; promptId: string; position: number }
    | {
          type: "PROMPT_GREENLIT";
          promptId: string;
          reasoning: string;
      }
    | {
          type: "PROMPT_REDLIT";
          promptId: string;
          reasoning: string;
          conflicts: string[];
      }
    | { type: "PROMPT_APPROVED"; promptId: string }
    | { type: "PROMPT_DENIED"; promptId: string; reason: string }
    | {
          type: "HOST_REVIEW_REQUEST";
          promptId: string;
          username: string;
          content: string;
          reasoning: string;
          conflicts: string[];
      }
    | {
          type: "ACTIVITY";
          username: string;
          event: string;
          timestamp: number;
      }
    | { type: "ERROR"; message: string; code: string }
    | {
          type: "LOCAL_PROMPT_SUBMITTED";
          promptId: string;
          content: string;
      }
    | { type: "REVIEW_SHIFT" }
    | { type: "FEATURE_CREATED"; promptId: string; title: string }
    | { type: "EXECUTION_QUEUED"; promptId: string }
    | { type: "EXECUTION_UPDATE"; promptId: string; stage: string }
    | {
          type: "EXECUTION_COMPLETE";
          promptId: string;
          files: FileChange[];
          summary: string;
      }
    | {
          type: "MEMBER_EXECUTION_UPDATE";
          username: string;
          promptId: string;
          stage: string;
      }
    | {
          type: "MEMBER_EXECUTION_COMPLETE";
          username: string;
          promptId: string;
          files: FileChange[];
          summary: string;
      }
    | { type: "SYSTEM_STATUS"; executionBackendAvailable: boolean }
    | { type: "SET_VIEWING"; username: string | null }
    | { type: "SHELL_OUTPUT"; output: string; command: string }
    | { type: "MERGE_UPDATE"; stage: string }
    | {
          type: "MERGE_COMPLETE";
          filesResolved: number;
          prUrl?: string;
          hasLowConfidence: boolean;
          branchName: string;
          summary: string;
      }
    | { type: "MERGE_ERROR"; message: string }
    | { type: "TOGGLE_EXPAND" }
    | { type: "SCROLL_UP" }
    | { type: "SCROLL_DOWN" }
    | { type: "SCROLL_BOTTOM" };

// ─── Helpers ───

/** Create a unique entry id from a prefix and timestamp. */
function entryId(prefix: string): string {
    return `${prefix}-${Date.now()}`;
}

/**
 * Cap for the in-memory history array. Prevents unbounded
 * memory growth during long sessions. When exceeded, the
 * oldest entries are dropped.
 */
const MAX_HISTORY_ENTRIES = 500;

/** Append a history entry immutably, capping total size. */
function appendHistory(
    history: readonly HistoryEntry[],
    entry: HistoryEntry
): readonly HistoryEntry[] {
    const next = [...history, entry];
    if (next.length > MAX_HISTORY_ENTRIES) {
        return next.slice(next.length - MAX_HISTORY_ENTRIES);
    }
    return next;
}

// ─── Reducer ───

function rawReducer(state: AppState, action: Action): AppState {
    switch (action.type) {
        case "CONNECTED":
            return { ...state, connectionStatus: "connected" };

        case "DISCONNECTED":
            return { ...state, connectionStatus: "disconnected" };

        case "RECONNECTING":
            return { ...state, connectionStatus: "reconnecting" };

        case "JOIN_ACK":
            return {
                ...state,
                partyCode: action.partyCode,
                isHost: action.isHost,
                myUsername: action.myUsername,
                members: action.members.map((username, i) => ({
                    username,
                    isHost: i === 0,
                    status: "idle",
                })),
            };

        case "MEMBER_JOINED":
            return {
                ...state,
                members: [
                    ...state.members,
                    {
                        username: action.username,
                        isHost: false,
                        status: "idle",
                    },
                ],
            };

        case "MEMBER_LEFT":
            return {
                ...state,
                members: state.members.filter(
                    (m) => m.username !== action.username
                ),
                viewingMember:
                    state.viewingMember === action.username
                        ? null
                        : state.viewingMember,
            };

        case "MEMBER_STATUS":
            return {
                ...state,
                members: state.members.map((m) =>
                    m.username === action.username
                        ? { ...m, status: action.status }
                        : m
                ),
            };

        case "LOCAL_PROMPT_SUBMITTED":
            return {
                ...state,
                activePromptId: action.promptId,
                viewingMember: null,
                history: appendHistory(state.history, {
                    kind: "user-prompt",
                    id: entryId("prompt"),
                    promptId: action.promptId,
                    content: action.content,
                    timestamp: Date.now(),
                }),
            };

        case "PROMPT_QUEUED":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("queued"),
                    promptId: action.promptId,
                    status: "queued",
                    message: `Position: ${action.position}`,
                    timestamp: Date.now(),
                }),
            };

        case "PROMPT_GREENLIT":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("greenlit"),
                    promptId: action.promptId,
                    status: "greenlit",
                    message: action.reasoning,
                    timestamp: Date.now(),
                }),
            };

        case "FEATURE_CREATED":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("feature"),
                    promptId: action.promptId,
                    status: "feature-created",
                    message: `Assigned to New Core Feature: ${action.title}`,
                    timestamp: Date.now(),
                }),
            };

        case "PROMPT_REDLIT":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("redlit"),
                    promptId: action.promptId,
                    status: "redlit",
                    message: `${action.reasoning}${action.conflicts.length > 0 ? `\nConflicts: ${action.conflicts.join(", ")}` : ""}`,
                    timestamp: Date.now(),
                }),
            };

        case "PROMPT_APPROVED":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("approved"),
                    promptId: action.promptId,
                    status: "approved",
                    message: "Approved by host",
                    timestamp: Date.now(),
                }),
            };

        case "PROMPT_DENIED":
            return {
                ...state,
                activePromptId: null,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("denied"),
                    promptId: action.promptId,
                    status: "denied",
                    message: action.reason,
                    timestamp: Date.now(),
                }),
            };

        case "HOST_REVIEW_REQUEST":
            return {
                ...state,
                reviewQueue: [
                    ...state.reviewQueue,
                    {
                        promptId: action.promptId,
                        username: action.username,
                        content: action.content,
                        reasoning: action.reasoning,
                        conflicts: action.conflicts,
                    },
                ],
            };

        case "REVIEW_SHIFT":
            return {
                ...state,
                reviewQueue: state.reviewQueue.slice(1),
            };

        case "EXECUTION_QUEUED":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "status",
                    id: entryId("exec-q"),
                    promptId: action.promptId,
                    status: "execution-queued",
                    message: "Queued for execution",
                    timestamp: Date.now(),
                }),
            };

        case "EXECUTION_UPDATE":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "agent-event",
                    id: entryId("exec-upd"),
                    promptId: action.promptId,
                    eventType: "stage",
                    data: { stage: action.stage },
                    timestamp: Date.now(),
                }),
            };

        case "EXECUTION_COMPLETE": {
            const hasFiles = action.files.length > 0;
            const hitMaxRounds = action.summary.includes(
                "max rounds reached"
            );

            let summary: string;
            if (hasFiles) {
                const fileList = action.files
                    .map(
                        (f) =>
                            `  ${f.path} (+${f.linesAdded}/-${f.linesRemoved})`
                    )
                    .join("\n");
                summary = `${action.summary}\n${fileList}`;
            } else if (hitMaxRounds) {
                summary =
                    "Execution failed: agent exhausted all " +
                    "rounds without producing changes.";
            } else {
                summary = `${action.summary}\n  No files were changed.`;
            }

            return {
                ...state,
                activePromptId: null,
                history: appendHistory(state.history, {
                    kind: "completion",
                    id: entryId("complete"),
                    promptId: action.promptId,
                    files: action.files,
                    summary,
                    timestamp: Date.now(),
                }),
            };
        }

        case "MEMBER_EXECUTION_UPDATE":
            return {
                ...state,
                memberExecutions: {
                    ...state.memberExecutions,
                    [action.username]: {
                        promptId: action.promptId,
                        stage: action.stage,
                        files: [],
                        summary: null,
                        completed: false,
                    },
                },
            };

        case "MEMBER_EXECUTION_COMPLETE":
            return {
                ...state,
                memberExecutions: {
                    ...state.memberExecutions,
                    [action.username]: {
                        promptId: action.promptId,
                        stage: null,
                        files: action.files,
                        summary: action.summary,
                        completed: true,
                    },
                },
            };

        case "SYSTEM_STATUS":
            return {
                ...state,
                executionBackendAvailable:
                    action.executionBackendAvailable,
            };

        case "ACTIVITY":
            return {
                ...state,
                events: [
                    ...state.events,
                    {
                        username: action.username,
                        event: action.event,
                        timestamp: action.timestamp,
                    },
                ],
            };

        case "ERROR":
            if (
                action.code === "HOST_DISCONNECTED" ||
                action.code === "PARTY_ENDED"
            ) {
                return {
                    ...state,
                    partyEnded: true,
                    errorMessage: action.message,
                };
            }
            if (action.code === "EXECUTION_FAILED") {
                return {
                    ...state,
                    errorMessage: action.message,
                    activePromptId: null,
                };
            }
            return { ...state, errorMessage: action.message };

        case "SET_VIEWING":
            return { ...state, viewingMember: action.username };

        case "SHELL_OUTPUT":
            return {
                ...state,
                history: appendHistory(state.history, {
                    kind: "shell",
                    id: entryId("shell"),
                    command: action.command,
                    output: action.output,
                    timestamp: Date.now(),
                }),
            };

        case "MERGE_UPDATE":
            return {
                ...state,
                mergeInProgress: true,
                mergeStage: action.stage,
                history: appendHistory(state.history, {
                    kind: "merge",
                    id: entryId("merge-upd"),
                    message: action.stage,
                    status: "progress",
                    timestamp: Date.now(),
                }),
            };

        case "MERGE_COMPLETE": {
            const mergeMsg =
                `Merge complete: ${action.filesResolved} ` +
                `file(s) resolved on branch ` +
                `${action.branchName}` +
                (action.prUrl ? `\nPR: ${action.prUrl}` : "") +
                (action.hasLowConfidence
                    ? "\nSome resolutions have low confidence"
                    : "");
            return {
                ...state,
                mergeInProgress: false,
                mergeStage: null,
                history: appendHistory(state.history, {
                    kind: "merge",
                    id: entryId("merge-done"),
                    message: mergeMsg,
                    status: "complete",
                    timestamp: Date.now(),
                }),
            };
        }

        case "MERGE_ERROR":
            return {
                ...state,
                mergeInProgress: false,
                mergeStage: null,
                history: appendHistory(state.history, {
                    kind: "merge",
                    id: entryId("merge-err"),
                    message: `Merge failed: ${action.message}`,
                    status: "error",
                    timestamp: Date.now(),
                }),
            };

        case "TOGGLE_EXPAND": {
            const lastAgentEvent = [...state.history]
                .reverse()
                .find((e) => e.kind === "agent-event");
            if (!lastAgentEvent) return state;
            const nextId =
                state.expandedEntryId === lastAgentEvent.id
                    ? null
                    : lastAgentEvent.id;
            return { ...state, expandedEntryId: nextId };
        }

        case "SCROLL_UP":
            return {
                ...state,
                scrollOffset: Math.min(
                    state.scrollOffset + 3,
                    Math.max(0, state.history.length - 3)
                ),
            };

        case "SCROLL_DOWN":
            return {
                ...state,
                scrollOffset: Math.max(0, state.scrollOffset - 3),
            };

        case "SCROLL_BOTTOM":
            return { ...state, scrollOffset: 0 };

        default:
            return state;
    }
}

/** Auto-scroll to bottom when new history entries arrive (if user is at bottom). */
function reducer(state: AppState, action: Action): AppState {
    const prev = state.history.length;
    const next = rawReducer(state, action);
    if (next.history.length > prev && state.scrollOffset === 0) {
        return { ...next, scrollOffset: 0 };
    }
    return next;
}

// ─── App ───

interface AppProps {
    connection: Connection;
    session: Session;
    inviteCode?: string;
}

export default function App({
    connection,
    session,
    inviteCode,
}: AppProps): React.ReactElement {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { stdout } = useStdout();
    const height = stdout?.rows ?? 30;
    const { exit } = useApp();

    // Keyboard handlers
    useInput(
        useCallback(
            (input: string, key) => {
                if (state.partyEnded) {
                    exit();
                    return;
                }

                // Scroll: up/down arrows, Ctrl+B = bottom
                if (key.upArrow) {
                    dispatch({ type: "SCROLL_UP" });
                    return;
                }
                if (key.downArrow) {
                    dispatch({ type: "SCROLL_DOWN" });
                    return;
                }
                if (key.ctrl && input === "b") {
                    dispatch({ type: "SCROLL_BOTTOM" });
                    return;
                }

                // Ctrl+O: toggle expand on most recent agent-event
                if (key.ctrl && input === "o") {
                    dispatch({ type: "TOGGLE_EXPAND" });
                    return;
                }

                // Screen Viewing (Ctrl+1...8)
                if (
                    key.ctrl &&
                    input >= "1" &&
                    input <= "8"
                ) {
                    const index = parseInt(input, 10) - 1;
                    if (
                        index >= 0 &&
                        index < state.members.length
                    ) {
                        const target =
                            state.members[index].username;
                        if (target === state.myUsername) {
                            dispatch({
                                type: "SET_VIEWING",
                                username: null,
                            });
                        } else {
                            dispatch({
                                type: "SET_VIEWING",
                                username: target,
                            });
                        }
                    }
                }
            },
            [
                state.partyEnded,
                state.members,
                state.myUsername,
                exit,
            ]
        )
    );

    // Subscribe to connection events
    useEffect(() => {
        const onConnected = () =>
            dispatch({ type: "CONNECTED" });
        const onDisconnected = () =>
            dispatch({ type: "DISCONNECTED" });
        const onReconnecting = () =>
            dispatch({ type: "RECONNECTING" });

        connection.on("connected", onConnected);
        connection.on("disconnected", onDisconnected);
        connection.on("reconnecting", onReconnecting);

        return () => {
            connection.off("connected", onConnected);
            connection.off("disconnected", onDisconnected);
            connection.off("reconnecting", onReconnecting);
        };
    }, [connection]);

    // Subscribe to server messages
    useEffect(() => {
        const handler = (msg: ServerMessage) => {
            switch (msg.type) {
                case "join-ack":
                    dispatch({
                        type: "JOIN_ACK",
                        partyCode: msg.payload.partyCode,
                        members: msg.payload.members,
                        isHost: msg.payload.isHost,
                        myUsername: session.username,
                    });
                    break;
                case "member-joined":
                    dispatch({
                        type: "MEMBER_JOINED",
                        username: msg.payload.username,
                    });
                    break;
                case "member-left":
                    dispatch({
                        type: "MEMBER_LEFT",
                        username: msg.payload.username,
                    });
                    break;
                case "member-status":
                    dispatch({
                        type: "MEMBER_STATUS",
                        username: msg.payload.username,
                        status: msg.payload.status,
                    });
                    break;
                case "prompt-queued":
                    dispatch({
                        type: "PROMPT_QUEUED",
                        promptId: msg.payload.promptId,
                        position: msg.payload.position,
                    });
                    break;
                case "prompt-greenlit":
                    dispatch({
                        type: "PROMPT_GREENLIT",
                        promptId: msg.payload.promptId,
                        reasoning: msg.payload.reasoning,
                    });
                    break;
                case "prompt-redlit":
                    dispatch({
                        type: "PROMPT_REDLIT",
                        promptId: msg.payload.promptId,
                        reasoning: msg.payload.reasoning,
                        conflicts: msg.payload.conflicts,
                    });
                    break;
                case "prompt-approved":
                    dispatch({
                        type: "PROMPT_APPROVED",
                        promptId: msg.payload.promptId,
                    });
                    break;
                case "feature-created":
                    dispatch({
                        type: "FEATURE_CREATED",
                        promptId: msg.payload.promptId,
                        title: msg.payload.title,
                    });
                    break;
                case "prompt-denied":
                    dispatch({
                        type: "PROMPT_DENIED",
                        promptId: msg.payload.promptId,
                        reason: msg.payload.reason,
                    });
                    break;
                case "host-review-request":
                    dispatch({
                        type: "HOST_REVIEW_REQUEST",
                        promptId: msg.payload.promptId,
                        username: msg.payload.username,
                        content: msg.payload.content,
                        reasoning: msg.payload.reasoning,
                        conflicts: msg.payload.conflicts,
                    });
                    break;
                case "execution-queued":
                    dispatch({
                        type: "EXECUTION_QUEUED",
                        promptId: msg.payload.promptId,
                    });
                    break;
                case "execution-update":
                    dispatch({
                        type: "EXECUTION_UPDATE",
                        promptId: msg.payload.promptId,
                        stage: msg.payload.stage,
                    });
                    break;
                case "execution-complete":
                    dispatch({
                        type: "EXECUTION_COMPLETE",
                        promptId: msg.payload.promptId,
                        files: msg.payload.files,
                        summary: msg.payload.summary,
                    });
                    break;
                case "member-execution-update":
                    dispatch({
                        type: "MEMBER_EXECUTION_UPDATE",
                        username: msg.payload.username,
                        promptId: msg.payload.promptId,
                        stage: msg.payload.stage,
                    });
                    break;
                case "member-execution-complete":
                    dispatch({
                        type: "MEMBER_EXECUTION_COMPLETE",
                        username: msg.payload.username,
                        promptId: msg.payload.promptId,
                        files: msg.payload.files,
                        summary: msg.payload.summary,
                    });
                    break;
                case "system-status":
                    dispatch({
                        type: "SYSTEM_STATUS",
                        executionBackendAvailable:
                            msg.payload.executionBackendAvailable,
                    });
                    break;
                case "activity":
                    dispatch({
                        type: "ACTIVITY",
                        username: msg.payload.username,
                        event: msg.payload.event,
                        timestamp: msg.payload.timestamp,
                    });
                    break;
                case "error":
                    dispatch({
                        type: "ERROR",
                        message: msg.payload.message,
                        code: msg.payload.code,
                    });
                    break;
                case "merge-update":
                    dispatch({
                        type: "MERGE_UPDATE",
                        stage: msg.payload.stage,
                    });
                    break;
                case "merge-complete":
                    dispatch({
                        type: "MERGE_COMPLETE",
                        filesResolved: msg.payload.filesResolved,
                        prUrl: msg.payload.prUrl,
                        hasLowConfidence:
                            msg.payload.hasLowConfidence,
                        branchName: msg.payload.branchName,
                        summary: msg.payload.summary,
                    });
                    break;
                case "merge-error":
                    dispatch({
                        type: "MERGE_ERROR",
                        message: msg.payload.message,
                    });
                    break;
            }
        };

        connection.onMessage(handler);
        return () => {
            connection.off("message", handler);
        };
    }, [connection, session.username]);

    const handlePromptSubmit = useCallback(
        (promptId: string, content: string) => {
            if (!content.trim()) return;

            // Slash commands
            if (content.startsWith("/")) {
                const cmd = content
                    .slice(1)
                    .trim()
                    .toLowerCase();
                if (cmd === "invite") {
                    const code =
                        inviteCode ?? state.partyCode;
                    if (code) {
                        import("node:child_process").then(
                            ({ execSync }) => {
                                try {
                                    execSync(
                                        `printf '%s' ${JSON.stringify(code)} | pbcopy`
                                    );
                                    dispatch({
                                        type: "SHELL_OUTPUT",
                                        output: `Invite code copied: ${code}`,
                                        command: "/invite",
                                    });
                                } catch {
                                    dispatch({
                                        type: "SHELL_OUTPUT",
                                        output: `Invite code: ${code} (clipboard copy failed)`,
                                        command: "/invite",
                                    });
                                }
                            }
                        );
                    } else {
                        dispatch({
                            type: "SHELL_OUTPUT",
                            output: "No invite code available.",
                            command: "/invite",
                        });
                    }
                    return;
                }
                if (cmd === "leave") {
                    connection.disconnect();
                    exit();
                    return;
                }
                if (cmd === "merge") {
                    if (!state.isHost) {
                        dispatch({
                            type: "SHELL_OUTPUT",
                            output: "Only the host can run /merge.",
                            command: "/merge",
                        });
                        return;
                    }
                    if (state.mergeInProgress) {
                        dispatch({
                            type: "SHELL_OUTPUT",
                            output: "Merge already in progress.",
                            command: "/merge",
                        });
                        return;
                    }
                    connection.send({
                        type: "merge-request",
                        payload: {},
                    });
                    dispatch({
                        type: "MERGE_UPDATE",
                        stage: "Starting merge...",
                    });
                    return;
                }
                dispatch({
                    type: "SHELL_OUTPUT",
                    output: `Unknown command: /${cmd}\nAvailable: /invite, /leave, /merge`,
                    command: `/${cmd}`,
                });
                return;
            }

            // Shell commands
            if (content.startsWith("!")) {
                const cmd = content.slice(1).trim();
                if (!cmd) return;
                import("node:child_process").then(
                    ({ execSync }) => {
                        try {
                            const output = execSync(cmd, {
                                encoding: "utf-8",
                                timeout: 10000,
                                cwd: process.cwd(),
                            }).trim();
                            dispatch({
                                type: "SHELL_OUTPUT",
                                output: output || "(no output)",
                                command: cmd,
                            });
                        } catch (err: unknown) {
                            const msg =
                                err instanceof Error
                                    ? err.message
                                    : String(err);
                            dispatch({
                                type: "SHELL_OUTPUT",
                                output: `Error: ${msg}`,
                                command: cmd,
                            });
                        }
                    }
                );
                return;
            }

            if (state.activePromptId) return;

            dispatch({
                type: "LOCAL_PROMPT_SUBMITTED",
                promptId,
                content,
            });
            session.submitPrompt(promptId, content);
        },
        [
            session,
            state.activePromptId,
            inviteCode,
            state.partyCode,
            connection,
            exit,
            state.isHost,
            state.mergeInProgress,
        ]
    );

    const handleTyping = useCallback(() => {
        session.sendStatusUpdate("typing");
    }, [session]);

    const handleIdle = useCallback(() => {
        session.sendStatusUpdate("idle");
    }, [session]);

    const handleApprove = useCallback(
        (promptId: string) => {
            connection.send({
                type: "host-verdict",
                payload: { promptId, verdict: "approve" },
            });
            dispatch({ type: "REVIEW_SHIFT" });
        },
        [connection]
    );

    const handleDeny = useCallback(
        (promptId: string, reason: string) => {
            connection.send({
                type: "host-verdict",
                payload: { promptId, verdict: "deny", reason },
            });
            dispatch({ type: "REVIEW_SHIFT" });
        },
        [connection]
    );

    const currentReview = state.reviewQueue[0] ?? null;
    let inputDisabled =
        state.activePromptId !== null ||
        currentReview !== null ||
        state.partyEnded;
    if (state.viewingMember) inputDisabled = true;

    // ─── Party ended overlay ───
    if (state.partyEnded) {
        return (
            <Box
                flexDirection="column"
                height={height}
                justifyContent="center"
                alignItems="center"
            >
                <Text bold color="red">
                    {state.errorMessage ?? "Party ended."}
                </Text>
                <Text dimColor>
                    Press any key to exit.
                </Text>
            </Box>
        );
    }

    // ─── Render main content area ───
    const renderMainContent = () => {
        // Viewing someone else's screen
        if (state.viewingMember) {
            const exec =
                state.memberExecutions[state.viewingMember];

            return (
                <Box
                    flexDirection="column"
                    flexGrow={1}
                    borderStyle="single"
                    borderColor="magenta"
                >
                    <Box
                        paddingX={1}
                        borderBottom={true}
                        borderColor="magenta"
                    >
                        <Text bold color="magenta">
                            Viewing {state.viewingMember}
                            {"'"}s Screen (Ctrl+your index
                            to exit)
                        </Text>
                    </Box>
                    <Box
                        flexDirection="column"
                        flexGrow={1}
                    >
                        {exec ? (
                            <ExecutionView
                                execution={exec}
                            />
                        ) : (
                            <Box
                                flexDirection="column"
                                flexGrow={1}
                                justifyContent="center"
                                alignItems="center"
                            >
                                <Text dimColor>
                                    {state.viewingMember}{" "}
                                    is not currently
                                    executing a prompt.
                                </Text>
                            </Box>
                        )}
                    </Box>
                </Box>
            );
        }

        // Default: HistoryView (scrollable chat history)
        return (
            <HistoryView
                history={state.history}
                expandedEntryId={state.expandedEntryId}
                scrollOffset={state.scrollOffset}
            />
        );
    };

    return (
        <Box flexDirection="column" height={height}>
            <StatusBar
                partyCode={state.partyCode}
                memberCount={state.members.length}
                connectionStatus={state.connectionStatus}
                executionBackendAvailable={
                    state.executionBackendAvailable
                }
                inviteCode={
                    state.isHost ? inviteCode : undefined
                }
            />
            <Box flexDirection="row" flexGrow={1}>
                <PartyPanel members={state.members} />
                {renderMainContent()}
            </Box>

            {currentReview &&
                state.isHost &&
                !state.viewingMember && (
                    <ReviewPanel
                        request={currentReview}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                    />
                )}

            <ActivityFeed events={state.events} />
            <PromptInput
                disabled={inputDisabled}
                onSubmit={handlePromptSubmit}
                onTyping={handleTyping}
                onIdle={handleIdle}
            />
        </Box>
    );
}
