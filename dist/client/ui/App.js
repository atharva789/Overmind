import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useReducer, useEffect, useCallback } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import StatusBar from "./StatusBar.js";
import PartyPanel from "./PartyPanel.js";
import OutputView from "./OutputView.js";
import ActivityFeed from "./ActivityFeed.js";
import PromptInput from "./PromptInput.js";
import ReviewPanel from "./ReviewPanel.js";
import ExecutionView from "./ExecutionView.js";
const initialState = {
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
    mergeInProgress: false,
    mergeStage: null,
};
function addOutput(outputs, promptId, status, message, promptContent) {
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
function reducer(state, action) {
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
                members: state.members.map((m) => m.username === action.username ? { ...m, status: action.status } : m),
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
                outputs: addOutput(state.outputs, action.promptId, "greenlit", action.reasoning, state.promptContents[action.promptId]),
            };
        case "FEATURE_CREATED":
            return {
                ...state,
                outputs: addOutput(state.outputs, action.promptId, "feature-created", `Assigned to New Core Feature: ${action.title}`, state.promptContents[action.promptId]),
            };
        case "PROMPT_REDLIT":
            return {
                ...state,
                outputs: addOutput(state.outputs, action.promptId, "redlit", action.reasoning, state.promptContents[action.promptId]),
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
            if (state.execution?.promptId !== action.promptId)
                return state;
            return {
                ...state,
                execution: { ...state.execution, stage: action.stage },
            };
        case "EXECUTION_COMPLETE": {
            if (state.execution?.promptId !== action.promptId)
                return state;
            const hasFiles = action.files.length > 0;
            const hitMaxRounds = action.summary.includes("max rounds reached");
            let status;
            let completeMsg;
            if (hasFiles) {
                const fileList = action.files
                    .map(f => `  ${f.path} (+${f.linesAdded}/-${f.linesRemoved})`)
                    .join("\n");
                completeMsg = `${action.summary}\n${fileList}`;
                status = "complete";
            }
            else if (hitMaxRounds) {
                completeMsg = `Execution failed: agent exhausted all rounds without producing changes.`;
                status = "error";
            }
            else {
                completeMsg = `${action.summary}\n  No files were changed.`;
                status = "complete";
            }
            return {
                ...state,
                outputs: addOutput(state.outputs, action.promptId, status, completeMsg),
                execution: null,
                currentPromptId: null,
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
            if (action.code === "EXECUTION_FAILED") {
                return {
                    ...state,
                    errorMessage: action.message,
                    currentPromptId: null,
                    execution: null,
                };
            }
            return { ...state, errorMessage: action.message };
        case "SET_VIEWING":
            return { ...state, viewingMember: action.username };
        case "SHELL_OUTPUT":
            return {
                ...state,
                outputs: addOutput(state.outputs, `shell-${Date.now()}`, "complete", `$ ${action.command}\n${action.output}`),
            };
        case "MERGE_UPDATE":
            return {
                ...state,
                mergeInProgress: true,
                mergeStage: action.stage,
            };
        case "MERGE_COMPLETE": {
            const mergeMsg = `Merge complete: ${action.filesResolved} file(s) resolved on branch ${action.branchName}${action.prUrl ? `\nPR: ${action.prUrl}` : ""}${action.hasLowConfidence ? "\n⚠ Some resolutions have low confidence" : ""}`;
            return {
                ...state,
                mergeInProgress: false,
                mergeStage: null,
                outputs: addOutput(state.outputs, `merge-${Date.now()}`, "complete", mergeMsg),
            };
        }
        case "MERGE_ERROR":
            return {
                ...state,
                mergeInProgress: false,
                mergeStage: null,
                outputs: addOutput(state.outputs, `merge-${Date.now()}`, "error", `Merge failed: ${action.message}`),
            };
        default:
            return state;
    }
}
export default function App({ connection, session, inviteCode }) {
    const [state, dispatch] = useReducer(reducer, initialState);
    const { stdout } = useStdout();
    const height = stdout?.rows ?? 30;
    const { exit } = useApp();
    // Keyboard handlers
    useInput(useCallback((input, key) => {
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
                }
                else {
                    dispatch({ type: "SET_VIEWING", username: target });
                }
            }
        }
    }, [state.partyEnded, state.members, state.myUsername, exit]));
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
        const handler = (msg) => {
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
                case "merge-update":
                    dispatch({ type: "MERGE_UPDATE", stage: msg.payload.stage });
                    break;
                case "merge-complete":
                    dispatch({
                        type: "MERGE_COMPLETE",
                        filesResolved: msg.payload.filesResolved,
                        prUrl: msg.payload.prUrl,
                        hasLowConfidence: msg.payload.hasLowConfidence,
                        branchName: msg.payload.branchName,
                        summary: msg.payload.summary,
                    });
                    break;
                case "merge-error":
                    dispatch({ type: "MERGE_ERROR", message: msg.payload.message });
                    break;
            }
        };
        connection.onMessage(handler);
        return () => {
            connection.off("message", handler);
        };
    }, [connection, session.username]);
    const handlePromptSubmit = useCallback((promptId, content) => {
        if (!content.trim())
            return;
        // Slash commands
        if (content.startsWith("/")) {
            const cmd = content.slice(1).trim().toLowerCase();
            if (cmd === "invite") {
                const code = inviteCode ?? state.partyCode;
                if (code) {
                    import("node:child_process").then(({ execSync }) => {
                        try {
                            execSync(`printf '%s' ${JSON.stringify(code)} | pbcopy`);
                            dispatch({ type: "SHELL_OUTPUT", output: `Invite code copied: ${code}`, command: "/invite" });
                        }
                        catch {
                            dispatch({ type: "SHELL_OUTPUT", output: `Invite code: ${code} (clipboard copy failed)`, command: "/invite" });
                        }
                    });
                }
                else {
                    dispatch({ type: "SHELL_OUTPUT", output: "No invite code available.", command: "/invite" });
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
                    dispatch({ type: "SHELL_OUTPUT", output: "Only the host can run /merge.", command: "/merge" });
                    return;
                }
                if (state.mergeInProgress) {
                    dispatch({ type: "SHELL_OUTPUT", output: "Merge already in progress.", command: "/merge" });
                    return;
                }
                connection.send({ type: "merge-request", payload: {} });
                dispatch({ type: "MERGE_UPDATE", stage: "Starting merge..." });
                return;
            }
            dispatch({ type: "SHELL_OUTPUT", output: `Unknown command: /${cmd}\nAvailable: /invite, /leave, /merge`, command: `/${cmd}` });
            return;
        }
        // Shell commands
        if (content.startsWith("!")) {
            const cmd = content.slice(1).trim();
            if (!cmd)
                return;
            import("node:child_process").then(({ execSync }) => {
                try {
                    const output = execSync(cmd, {
                        encoding: "utf-8",
                        timeout: 10000,
                        cwd: process.cwd(),
                    }).trim();
                    dispatch({ type: "SHELL_OUTPUT", output: output || "(no output)", command: cmd });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    dispatch({ type: "SHELL_OUTPUT", output: `Error: ${msg}`, command: cmd });
                }
            });
            return;
        }
        if (state.currentPromptId)
            return;
        dispatch({ type: "LOCAL_PROMPT_SUBMITTED", promptId, content });
        session.submitPrompt(promptId, content);
    }, [session, state.currentPromptId, inviteCode, state.partyCode, connection, exit]);
    const handleTyping = useCallback(() => {
        session.sendStatusUpdate("typing");
    }, [session]);
    const handleIdle = useCallback(() => {
        session.sendStatusUpdate("idle");
    }, [session]);
    const handleApprove = useCallback((promptId) => {
        connection.send({
            type: "host-verdict",
            payload: { promptId, verdict: "approve" },
        });
        dispatch({ type: "REVIEW_SHIFT" });
    }, [connection]);
    const handleDeny = useCallback((promptId, reason) => {
        connection.send({
            type: "host-verdict",
            payload: { promptId, verdict: "deny", reason },
        });
        dispatch({ type: "REVIEW_SHIFT" });
    }, [connection]);
    const currentReview = state.reviewQueue[0] ?? null;
    let inputDisabled = state.currentPromptId !== null || currentReview !== null || state.partyEnded;
    if (state.viewingMember)
        inputDisabled = true;
    // ─── Party ended overlay ───
    if (state.partyEnded) {
        return (_jsxs(Box, { flexDirection: "column", height: height, justifyContent: "center", alignItems: "center", children: [_jsx(Text, { bold: true, color: "red", children: state.errorMessage ?? "Party ended." }), _jsx(Text, { dimColor: true, children: "Press any key to exit." })] }));
    }
    // ─── Render main content area ───
    const renderMainContent = () => {
        // Viewing someone else's screen
        if (state.viewingMember) {
            const exec = state.memberExecutions[state.viewingMember];
            return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: "magenta", children: [_jsx(Box, { paddingX: 1, borderBottom: true, borderColor: "magenta", children: _jsxs(Text, { bold: true, color: "magenta", children: ["\uD83D\uDC40 Viewing ", state.viewingMember, "'s Screen (Ctrl+your index to exit)"] }) }), _jsx(Box, { flexDirection: "column", flexGrow: 1, children: exec ? (_jsx(ExecutionView, { execution: exec })) : (_jsx(Box, { flexDirection: "column", flexGrow: 1, justifyContent: "center", alignItems: "center", children: _jsxs(Text, { dimColor: true, children: [state.viewingMember, " is not currently executing a prompt."] }) })) })] }));
        }
        // Show merge progress
        if (state.mergeInProgress && state.mergeStage) {
            return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, justifyContent: "center", alignItems: "center", children: [_jsx(Text, { bold: true, color: "cyan", children: "Merge in progress..." }), _jsx(Text, { dimColor: true, children: state.mergeStage })] }));
        }
        // Show ExecutionView for submitter during execution
        if (state.execution && !state.execution.completed) {
            return _jsx(ExecutionView, { execution: state.execution });
        }
        // Show completed execution
        if (state.execution?.completed) {
            return _jsx(ExecutionView, { execution: state.execution });
        }
        // Default: OutputView
        return (_jsx(OutputView, { outputs: state.outputs, currentPromptId: state.currentPromptId }));
    };
    return (_jsxs(Box, { flexDirection: "column", height: height, children: [_jsx(StatusBar, { partyCode: state.partyCode, memberCount: state.members.length, connectionStatus: state.connectionStatus, executionBackendAvailable: state.executionBackendAvailable, inviteCode: state.isHost ? inviteCode : undefined }), _jsxs(Box, { flexDirection: "row", flexGrow: 1, children: [_jsx(PartyPanel, { members: state.members }), renderMainContent()] }), currentReview && state.isHost && !state.viewingMember && (_jsx(ReviewPanel, { request: currentReview, onApprove: handleApprove, onDeny: handleDeny })), _jsx(ActivityFeed, { events: state.events }), _jsx(PromptInput, { disabled: inputDisabled, onSubmit: handlePromptSubmit, onTyping: handleTyping, onIdle: handleIdle })] }));
}
//# sourceMappingURL=App.js.map