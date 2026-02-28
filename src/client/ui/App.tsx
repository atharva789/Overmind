import React, { useReducer, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { Connection } from "../connection.js";
import type { Session } from "../session.js";
import type { ServerMessage, FileChange } from "../../shared/protocol.js";
import StatusBar from "./StatusBar.js";
import PartyPanel from "./PartyPanel.js";
import type { MemberView } from "./PartyPanel.js";
import OutputView from "./OutputView.js";
import type { OutputEntry, OutputStatus } from "./OutputView.js";
import ActivityFeed from "./ActivityFeed.js";
import type { ActivityEvent } from "./ActivityFeed.js";
import PromptInput from "./PromptInput.js";
import ReviewPanel from "./ReviewPanel.js";
import type { ReviewRequest } from "./ReviewPanel.js";
import ExecutionView from "./ExecutionView.js";
import type { ExecutionState } from "./ExecutionView.js";

// ─── State ───

interface AppState {
    myUsername: string;
    members: MemberView[];
    outputs: OutputEntry[];
    events: ActivityEvent[];
    connectionStatus: "connected" | "reconnecting" | "disconnected";
    currentPromptId: string | null;
    promptContents: Record<string, string>;
    isHost: boolean;
    partyCode: string;
    reviewQueue: ReviewRequest[];
    execution: ExecutionState | null;
    memberExecutions: Record<string, ExecutionState>;
    viewingMember: string | null;
    executionBackendAvailable: boolean;
    errorMessage: string | null;
    partyEnded: boolean;
}

const initialState: AppState = {
    myUsername: "",
    members: [],
    outputs: [],
    events: [],
    connectionStatus: "disconnected",
    currentPromptId: null,
    promptContents: {},
    isHost: false,
    partyCode: "",
    reviewQueue: [],
    execution: null,
    memberExecutions: {},
    viewingMember: null,
    executionBackendAvailable: true,
    errorMessage: null,
    partyEnded: false,
};

// ─── Actions ───

type Action =
    | { type: "CONNECTED" }
    | { type: "DISCONNECTED" }
    | { type: "RECONNECTING" }
    | { type: "JOIN_ACK"; partyCode: string; members: string[]; isHost: boolean; myUsername: string }
    | { type: "MEMBER_JOINED"; username: string }
    | { type: "MEMBER_LEFT"; username: string }
    | { type: "MEMBER_STATUS"; username: string; status: string }
    | { type: "PROMPT_QUEUED"; promptId: string; position: number }
    | { type: "PROMPT_GREENLIT"; promptId: string; reasoning: string }
    | { type: "PROMPT_REDLIT"; promptId: string; reasoning: string; conflicts: string[] }
    | { type: "PROMPT_APPROVED"; promptId: string }
    | { type: "PROMPT_DENIED"; promptId: string; reason: string }
    | { type: "HOST_REVIEW_REQUEST"; promptId: string; username: string; content: string; reasoning: string; conflicts: string[] }
    | { type: "ACTIVITY"; username: string; event: string; timestamp: number }
    | { type: "ERROR"; message: string; code: string }
    | { type: "LOCAL_PROMPT_SUBMITTED"; promptId: string; content: string }
    | { type: "REVIEW_SHIFT" }
    | { type: "FEATURE_CREATED"; promptId: string; title: string }
    | { type: "EXECUTION_QUEUED"; promptId: string }
    | { type: "EXECUTION_UPDATE"; promptId: string; stage: string }
    | { type: "EXECUTION_COMPLETE"; promptId: string; files: FileChange[]; summary: string }
    | { type: "MEMBER_EXECUTION_UPDATE"; username: string; promptId: string; stage: string }
    | { type: "MEMBER_EXECUTION_COMPLETE"; username: string; promptId: string; files: FileChange[]; summary: string }
    | { type: "SYSTEM_STATUS"; executionBackendAvailable: boolean }
    | { type: "SET_VIEWING"; username: string | null };

function addOutput(
    outputs: OutputEntry[],
    promptId: string,
    status: OutputStatus,
    message: string,
    promptContent?: string
): OutputEntry[] {
    return [
        ...outputs,
        {
            id: `${promptId}-${status}-${Date.now()}`,
            promptId,
            status,
            message,
            timestamp: Date.now(),
            promptContent,
        },
    ];
}

function reducer(state: AppState, action: Action): AppState {
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
                    { username: action.username, isHost: false, status: "idle" },
                ],
            };

        case "MEMBER_LEFT":
            return {
                ...state,
                members: state.members.filter((m) => m.username !== action.username),
                viewingMember: state.viewingMember === action.username ? null : state.viewingMember,
            };

        case "MEMBER_STATUS":
            return {
                ...state,
                members: state.members.map((m) =>
                    m.username === action.username ? { ...m, status: action.status } : m
                ),
            };

        case "LOCAL_PROMPT_SUBMITTED":
            return {
                ...state,
                currentPromptId: action.promptId,
                viewingMember: null,
                promptContents: { ...state.promptContents, [action.promptId]: action.content },
            };

        case "PROMPT_QUEUED":
            return {
                ...state,
                outputs: addOutput(state.outputs, action.promptId, "queued", `Position: ${action.position}`),
            };

        case "PROMPT_GREENLIT":
            return {
                ...state,
                outputs: addOutput(
                    state.outputs, action.promptId, "greenlit", action.reasoning,
                    state.promptContents[action.promptId]
                ),
            };

        case "FEATURE_CREATED":
            return {
                ...state,
                outputs: addOutput(
                    state.outputs, action.promptId, "feature-created", `Assigned to New Core Feature: ${action.title}`,
                    state.promptContents[action.promptId]
                ),
            };

        case "PROMPT_REDLIT":
            return {
                ...state,
                outputs: addOutput(
                    state.outputs, action.promptId, "redlit", action.reasoning,
                    state.promptContents[action.promptId]
                ),
            };

        case "PROMPT_APPROVED":
            return {
                ...state,
                outputs: addOutput(state.outputs, action.promptId, "approved", "Approved by host"),
            };

        case "PROMPT_DENIED":
            return {
                ...state,
                outputs: addOutput(state.outputs, action.promptId, "denied", action.reason),
                currentPromptId: null,
                execution: null,
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
                execution: {
                    promptId: action.promptId,
                    stage: null,
                    files: [],
                    summary: null,
                    completed: false,
                },
            };

        case "EXECUTION_UPDATE":
            if (state.execution?.promptId !== action.promptId) return state;
            return {
                ...state,
                execution: { ...state.execution, stage: action.stage },
            };

        case "EXECUTION_COMPLETE":
            if (state.execution?.promptId !== action.promptId) return state;
            return {
                ...state,
                execution: {
                    ...state.execution,
                    files: action.files,
                    summary: action.summary,
                    completed: true,
                    stage: null,
                },
                currentPromptId: null,
            };

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
                    }
                }
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
                    }
                }
            };

        case "SYSTEM_STATUS":
            return {
                ...state,
                executionBackendAvailable: action.executionBackendAvailable,
            };

        case "ACTIVITY":
            return {
                ...state,
                events: [
                    ...state.events,
                    { username: action.username, event: action.event, timestamp: action.timestamp },
                ],
            };

        case "ERROR":
            if (action.code === "HOST_DISCONNECTED" || action.code === "PARTY_ENDED") {
                return { ...state, partyEnded: true, errorMessage: action.message };
            }
            return { ...state, errorMessage: action.message };

        case "SET_VIEWING":
            return { ...state, viewingMember: action.username };

        default:
            return state;
    }
}

// ─── App ───

interface AppProps {
    connection: Connection;
    session: Session;
    inviteCode?: string;
}

export default function App({ connection, session, inviteCode }: AppProps): React.ReactElement {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { stdout } = useStdout();
    const height = stdout?.rows ?? 30;
    const { exit } = useApp();

    // Keyboard handlers
    useInput(
        useCallback((input: string, key) => {
            if (state.partyEnded) {
                exit();
                return;
            }

            // Screen Viewing (Ctrl+1...8)
            if (key.ctrl && input >= "1" && input <= "8") {
                const index = parseInt(input, 10) - 1;
                if (index >= 0 && index < state.members.length) {
                    const target = state.members[index].username;
                    if (target === state.myUsername) {
                        dispatch({ type: "SET_VIEWING", username: null });
                    } else {
                        dispatch({ type: "SET_VIEWING", username: target });
                    }
                }
            }
        }, [state.partyEnded, state.members, state.myUsername, exit]),
    );

    // Subscribe to connection events
    useEffect(() => {
        const onConnected = () => dispatch({ type: "CONNECTED" });
        const onDisconnected = () => dispatch({ type: "DISCONNECTED" });
        const onReconnecting = () => dispatch({ type: "RECONNECTING" });

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
                    dispatch({ type: "MEMBER_JOINED", username: msg.payload.username });
                    break;
                case "member-left":
                    dispatch({ type: "MEMBER_LEFT", username: msg.payload.username });
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
                    dispatch({ type: "PROMPT_APPROVED", promptId: msg.payload.promptId });
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
                    dispatch({ type: "EXECUTION_QUEUED", promptId: msg.payload.promptId });
                    break;
                case "execution-update":
                    dispatch({ type: "EXECUTION_UPDATE", promptId: msg.payload.promptId, stage: msg.payload.stage });
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
                        executionBackendAvailable: msg.payload.executionBackendAvailable,
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
                    dispatch({ type: "ERROR", message: msg.payload.message, code: msg.payload.code });
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
            if (state.currentPromptId) return;

            dispatch({ type: "LOCAL_PROMPT_SUBMITTED", promptId, content });
            session.submitPrompt(promptId, content);
        },
        [session, state.currentPromptId]
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
    let inputDisabled = state.currentPromptId !== null || currentReview !== null || state.partyEnded;
    if (state.viewingMember) inputDisabled = true;

    // ─── Party ended overlay ───
    if (state.partyEnded) {
        return (
            <Box flexDirection="column" height={height} justifyContent="center" alignItems="center">
                <Text bold color="red">{state.errorMessage ?? "Party ended."}</Text>
                <Text dimColor>Press any key to exit.</Text>
            </Box>
        );
    }

    // ─── Render main content area ───
    const renderMainContent = () => {
        // Viewing someone else's screen
        if (state.viewingMember) {
            const exec = state.memberExecutions[state.viewingMember];

            return (
                <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="magenta">
                    <Box paddingX={1} borderBottom={true} borderColor="magenta">
                        <Text bold color="magenta">👀 Viewing {state.viewingMember}'s Screen (Ctrl+your index to exit)</Text>
                    </Box>
                    <Box flexDirection="column" flexGrow={1}>
                        {exec ? (
                            <ExecutionView execution={exec} />
                        ) : (
                            <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
                                <Text dimColor>{state.viewingMember} is not currently executing a prompt.</Text>
                            </Box>
                        )}
                    </Box>
                </Box>
            );
        }

        // Show ExecutionView for submitter during execution
        if (state.execution && !state.execution.completed) {
            return <ExecutionView execution={state.execution} />;
        }

        // Show completed execution
        if (state.execution?.completed) {
            return <ExecutionView execution={state.execution} />;
        }

        // Default: OutputView
        return (
            <OutputView
                outputs={state.outputs}
                currentPromptId={state.currentPromptId}
            />
        );
    };

    return (
        <Box flexDirection="column" height={height}>
            <StatusBar
                partyCode={state.partyCode}
                memberCount={state.members.length}
                connectionStatus={state.connectionStatus}
                executionBackendAvailable={state.executionBackendAvailable}
                inviteCode={state.isHost ? inviteCode : undefined}
            />
            <Box flexDirection="row" flexGrow={1}>
                <PartyPanel members={state.members} />
                {renderMainContent()}
            </Box>

            {currentReview && state.isHost && !state.viewingMember && (
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
