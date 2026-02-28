import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Purpose: Root Ink UI component — single source of truth for all
 * app state in the Overmind TUI.
 *
 * High-level behavior: Subscribes to Connection events in a useEffect
 * and maps server messages to typed reducer actions. Renders the full
 * vertical layout: StatusBar → PartyPanel+OutputView → ActivityFeed →
 * PromptInput. Passes only data props and callbacks to children; no
 * business logic lives in child components.
 *
 * Assumptions:
 *  - session.start() is called by the CLI before this component mounts.
 *  - connection is the Connection instance owned by the Session.
 *  - process.stdout.columns reflects the current terminal width.
 *
 * Invariants:
 *  - All reducer actions map 1:1 to server message types.
 *  - No derived state is duplicated in AppState.
 *  - Prompt content from other members is never stored or rendered.
 */
import { useReducer, useEffect, useState } from "react";
import { Box, useStdout } from "ink";
import { StatusBar } from "./StatusBar.js";
import { PartyPanel } from "./PartyPanel.js";
import { OutputView } from "./OutputView.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { PromptInput } from "./PromptInput.js";
const VALID_STATUSES = new Set([
    "idle", "typing", "queued", "executing", "reviewing",
]);
function toMemberStatus(s) {
    return VALID_STATUSES.has(s) ? s : "idle";
}
function reducer(state, action) {
    switch (action.type) {
        case "JOIN_ACK":
            return {
                ...state,
                partyCode: action.partyCode,
                isHost: action.isHost,
                members: action.members.map((username, idx) => ({
                    username,
                    isHost: idx === 0,
                    status: "idle",
                })),
            };
        case "MEMBER_JOINED":
            if (state.members.some((m) => m.username === action.username)) {
                return state;
            }
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
            };
        case "MEMBER_STATUS":
            return {
                ...state,
                members: state.members.map((m) => m.username === action.username
                    ? { ...m, status: toMemberStatus(action.status) }
                    : m),
            };
        case "PROMPT_QUEUED":
            return {
                ...state,
                currentPromptId: action.promptId,
                outputs: [
                    ...state.outputs,
                    {
                        promptId: action.promptId,
                        type: "queued",
                        text: `Queued at position ${action.position}`,
                        timestamp: Date.now(),
                    },
                ],
            };
        case "PROMPT_GREENLIT":
            return {
                ...state,
                outputs: [
                    ...state.outputs,
                    {
                        promptId: action.promptId,
                        type: "greenlit",
                        text: action.reasoning,
                        timestamp: Date.now(),
                    },
                ],
            };
        case "PROMPT_REDLIT":
            return {
                ...state,
                currentPromptId: null,
                outputs: [
                    ...state.outputs,
                    {
                        promptId: action.promptId,
                        type: "redlit",
                        text: action.reasoning,
                        timestamp: Date.now(),
                    },
                ],
            };
        case "PROMPT_APPROVED":
            return {
                ...state,
                currentPromptId: null,
                outputs: [
                    ...state.outputs,
                    {
                        promptId: action.promptId,
                        type: "approved",
                        text: "Approved by host",
                        timestamp: Date.now(),
                    },
                ],
            };
        case "PROMPT_DENIED":
            return {
                ...state,
                currentPromptId: null,
                outputs: [
                    ...state.outputs,
                    {
                        promptId: action.promptId,
                        type: "denied",
                        text: action.reason,
                        timestamp: Date.now(),
                    },
                ],
            };
        case "ACTIVITY":
            return {
                ...state,
                events: [
                    ...state.events.slice(-4),
                    {
                        username: action.username,
                        event: action.event,
                        timestamp: action.timestamp,
                    },
                ],
            };
        case "ERROR":
            return {
                ...state,
                events: [
                    ...state.events.slice(-4),
                    {
                        username: "system",
                        event: `Error [${action.code}]: ${action.message}`,
                        timestamp: Date.now(),
                    },
                ],
            };
        case "CONNECTION_STATUS":
            return { ...state, connectionStatus: action.status };
        case "SET_PROMPT":
            return { ...state, currentPromptId: action.promptId };
        case "CLEAR_PROMPT":
            return { ...state, currentPromptId: null };
        default:
            return state;
    }
}
function msgToAction(msg) {
    switch (msg.type) {
        case "join-ack":
            return {
                type: "JOIN_ACK",
                partyCode: msg.payload.partyCode,
                members: msg.payload.members,
                isHost: msg.payload.isHost,
            };
        case "member-joined":
            return { type: "MEMBER_JOINED", username: msg.payload.username };
        case "member-left":
            return { type: "MEMBER_LEFT", username: msg.payload.username };
        case "member-status":
            return {
                type: "MEMBER_STATUS",
                username: msg.payload.username,
                status: msg.payload.status,
            };
        case "prompt-queued":
            return {
                type: "PROMPT_QUEUED",
                promptId: msg.payload.promptId,
                position: msg.payload.position,
            };
        case "prompt-greenlit":
            return {
                type: "PROMPT_GREENLIT",
                promptId: msg.payload.promptId,
                reasoning: msg.payload.reasoning,
            };
        case "prompt-redlit":
            return {
                type: "PROMPT_REDLIT",
                promptId: msg.payload.promptId,
                reasoning: msg.payload.reasoning,
            };
        case "prompt-approved":
            return { type: "PROMPT_APPROVED", promptId: msg.payload.promptId };
        case "prompt-denied":
            return {
                type: "PROMPT_DENIED",
                promptId: msg.payload.promptId,
                reason: msg.payload.reason,
            };
        case "activity":
            return {
                type: "ACTIVITY",
                username: msg.payload.username,
                event: msg.payload.event,
                timestamp: msg.payload.timestamp,
            };
        case "error":
            return {
                type: "ERROR",
                message: msg.payload.message,
                code: msg.payload.code,
            };
        case "host-review-request":
            // Host sees this as an activity — content is not surfaced here.
            return {
                type: "ACTIVITY",
                username: msg.payload.username,
                event: `review request · prompt ${msg.payload.promptId}`,
                timestamp: Date.now(),
            };
        default:
            return null;
    }
}
export function App({ connection, session }) {
    const [state, dispatch] = useReducer(reducer, {
        members: [],
        outputs: [],
        events: [],
        connectionStatus: "disconnected",
        currentPromptId: null,
        isHost: false,
        partyCode: session.partyCode,
    });
    const { stdout } = useStdout();
    const [termWidth, setTermWidth] = useState(stdout.columns ?? 80);
    // Update width on terminal resize.
    useEffect(() => {
        const onResize = () => setTermWidth(stdout.columns ?? 80);
        stdout.on("resize", onResize);
        return () => { stdout.off("resize", onResize); };
    }, [stdout]);
    // Subscribe to connection events and dispatch reducer actions.
    useEffect(() => {
        const onConnected = () => dispatch({ type: "CONNECTION_STATUS", status: "connected" });
        const onDisconnected = () => dispatch({ type: "CONNECTION_STATUS", status: "disconnected" });
        const onReconnecting = (_attempt) => dispatch({ type: "CONNECTION_STATUS", status: "reconnecting" });
        const onMessage = (msg) => {
            const action = msgToAction(msg);
            if (action)
                dispatch(action);
        };
        connection
            .on("connected", onConnected)
            .on("disconnected", onDisconnected)
            .on("reconnecting", onReconnecting)
            .on("message", onMessage);
        return () => {
            connection
                .off("connected", onConnected)
                .off("disconnected", onDisconnected)
                .off("reconnecting", onReconnecting)
                .off("message", onMessage);
        };
    }, [connection]);
    const panelWidth = termWidth < 60 ? 16 : 20;
    const outputWidth = termWidth - panelWidth - 2;
    function handleSubmit(content, promptId) {
        connection.send({
            type: "prompt-submit",
            payload: { promptId, content },
        });
        dispatch({ type: "SET_PROMPT", promptId });
    }
    function handleStatusChange(status) {
        connection.send({
            type: "status-update",
            payload: { status },
        });
    }
    return (_jsxs(Box, { flexDirection: "column", width: termWidth, children: [_jsx(StatusBar, { partyCode: state.partyCode, memberCount: state.members.length, connectionStatus: state.connectionStatus, width: termWidth }), _jsxs(Box, { flexDirection: "row", children: [_jsx(PartyPanel, { members: state.members, width: panelWidth }), _jsx(OutputView, { outputs: state.outputs, currentPromptId: state.currentPromptId, width: outputWidth })] }), _jsx(ActivityFeed, { events: state.events, width: termWidth }), _jsx(PromptInput, { disabled: state.currentPromptId !== null, onSubmit: handleSubmit, onStatusChange: handleStatusChange, width: termWidth })] }));
}
//# sourceMappingURL=App.js.map