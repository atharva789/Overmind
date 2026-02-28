/**
 * Purpose: Start and manage the WebSocket server and party lifecycle.
 * High-level behavior: Handles joins, prompt evaluation, and execution.
 * Assumptions: startServer is called by the host CLI process.
 * Invariants: Prompt content is never broadcast to non-host members.
 */
import { WebSocketServer, WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import { spawn } from "node:child_process";
import { Party } from "./party.js";
import { parseClientMessage } from "../shared/protocol.js";
import { DEFAULT_PORT, JOIN_TIMEOUT_MS, CONNECTION_ID_LENGTH, PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH, MAX_MEMBERS_DEFAULT, MODAL_BRIDGE_URL, MODAL_BRIDGE_PORT, BRIDGE_HEALTH_INTERVAL_MS, ErrorCode, } from "../shared/constants.js";
import { evaluatePrompt } from "./greenlight/agent.js";
import { Orchestrator } from "./orchestrator/index.js";
const generateConnectionId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", CONNECTION_ID_LENGTH);
const generatePartyCode = customAlphabet(PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH);
// ─── State ───
const PROJECT_ROOT = process.cwd();
const parties = new Map();
const evalQueues = new Map();
const pendingParties = new Map();
const orchestrators = new Map();
const pendingEvaluations = new Map();
const pendingExecutions = new Map();
let maxMembers = MAX_MEMBERS_DEFAULT;
let executionBackendAvailable = false;
let greenlightAvailable = computeGreenlightAvailable();
let bridgeProcess = null;
let bridgeHealthTimer = null;
/**
 * Configure the max members allowed per party.
 * Does not retroactively remove existing members.
 */
export function setMaxMembers(n) {
    maxMembers = n;
}
// ─── Logging ───
function log(msg, partyCode) {
    const ts = new Date().toISOString();
    const prefix = partyCode ? `[${ts}] [${partyCode}]` : `[${ts}]`;
    console.log(`${prefix} ${msg}`);
}
/**
 * Determine whether the greenlight backend is configured.
 * Does not validate credentials; only checks env presence.
 * Edge case: Both backends missing returns false.
 */
function computeGreenlightAvailable() {
    const hasGemini = Boolean(process.env["GEMINI_API_KEY"]);
    const hasGlm = Boolean(process.env["MODAL_GREENLIGHT_URL"]);
    return hasGemini || hasGlm;
}
/**
 * Decide whether execution should run locally or via Modal.
 * Does not verify that the local agent command exists.
 */
function isLocalMode() {
    return process.env["OVERMIND_LOCAL"] === "1";
}
/**
 * Update execution backend availability and broadcast to members.
 * Does not perform any health checks itself.
 */
function setExecutionBackendAvailable(value) {
    if (executionBackendAvailable === value)
        return;
    executionBackendAvailable = value;
    broadcastSystemStatus();
    if (executionBackendAvailable) {
        drainPendingExecutions();
    }
}
/**
 * Send system availability status to a single member.
 * Does not alter server state.
 */
function sendSystemStatus(party, connectionId) {
    party.sendTo(connectionId, {
        type: "system-status",
        payload: {
            greenlightAvailable,
            executionBackendAvailable: executionBackendAvailable || isLocalMode(),
        },
    });
}
/**
 * Broadcast system availability status to all members.
 * Does not mutate party membership.
 */
function broadcastSystemStatus() {
    for (const [, party] of parties) {
        party.broadcast({
            type: "system-status",
            payload: {
                greenlightAvailable,
                executionBackendAvailable: executionBackendAvailable || isLocalMode(),
            },
        });
    }
}
/**
 * Start the Modal bridge process and health checks if needed.
 * Does not throw; failures mark execution backend unavailable.
 */
async function initBridge() {
    if (isLocalMode()) {
        setExecutionBackendAvailable(true);
        return;
    }
    spawnBridgeProcess();
    await checkBridgeHealth();
    if (bridgeHealthTimer) {
        clearInterval(bridgeHealthTimer);
    }
    bridgeHealthTimer = setInterval(() => {
        void checkBridgeHealth();
    }, BRIDGE_HEALTH_INTERVAL_MS);
}
/**
 * Spawn the Modal bridge as a child process.
 * Does not guarantee the process is healthy.
 */
function spawnBridgeProcess() {
    if (bridgeProcess)
        return;
    bridgeProcess = spawn("python", ["-m", "uvicorn", "bridge:app", "--port", String(MODAL_BRIDGE_PORT)], {
        cwd: "modal-bridge",
        env: { ...process.env },
        stdio: "ignore",
    });
    bridgeProcess.on("error", (err) => {
        log(`Bridge process error: ${err.message}`);
        setExecutionBackendAvailable(false);
    });
    bridgeProcess.on("exit", (code) => {
        log(`Bridge process exited (${code ?? "?"})`);
        bridgeProcess = null;
        setExecutionBackendAvailable(false);
    });
}
/**
 * Check bridge health endpoint and update execution availability.
 * Does not throw; failures mark execution backend unavailable.
 */
async function checkBridgeHealth() {
    try {
        const res = await fetch(`${MODAL_BRIDGE_URL}/health`);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = (await res.json());
        setExecutionBackendAvailable(Boolean(data.modal_connected));
    }
    catch (err) {
        log(`Bridge health check failed: ${String(err)}`);
        setExecutionBackendAvailable(false);
    }
}
// ─── Public API ───
export function reserveParty(hostUsername) {
    const code = generatePartyCode();
    pendingParties.set(code, hostUsername);
    log("Party reserved", code);
    return code;
}
// ─── Server ───
/**
 * Start the WebSocket server and initialize bridge checks.
 * Does not block on bridge health; runs asynchronously.
 */
export function startServer() {
    const port = Number(process.env["OVERMIND_PORT"]) || DEFAULT_PORT;
    greenlightAvailable = computeGreenlightAvailable();
    void initBridge();
    const wss = new WebSocketServer({ port, host: "0.0.0.0" }, () => {
        log(`Overmind server listening on port ${port} (0.0.0.0)`);
    });
    wss.on("connection", (ws) => {
        const connectionId = generateConnectionId();
        let joined = false;
        let partyRef = null;
        const joinTimeout = setTimeout(() => {
            if (!joined) {
                sendRaw(ws, {
                    type: "error",
                    payload: {
                        message: "Join timeout",
                        code: ErrorCode.JOIN_TIMEOUT,
                    },
                });
                ws.close();
            }
        }, JOIN_TIMEOUT_MS);
        ws.on("message", (raw) => {
            const data = typeof raw === "string" ? raw : raw.toString("utf-8");
            const msg = parseClientMessage(data);
            if (!msg) {
                log(`Invalid message from ${connectionId}`);
                sendRaw(ws, {
                    type: "error",
                    payload: {
                        message: "Invalid message",
                        code: ErrorCode.INVALID_MESSAGE,
                    },
                });
                return;
            }
            if (!joined) {
                if (msg.type !== "join") {
                    sendRaw(ws, {
                        type: "error",
                        payload: {
                            message: "Must join first",
                            code: ErrorCode.INVALID_MESSAGE,
                        },
                    });
                    return;
                }
                handleJoin(ws, connectionId, msg, joinTimeout, (party) => {
                    joined = true;
                    partyRef = party;
                });
                return;
            }
            if (partyRef) {
                handleMessage(partyRef, connectionId, msg);
            }
        });
        ws.on("close", () => {
            clearTimeout(joinTimeout);
            if (partyRef) {
                handleDisconnect(partyRef, connectionId);
            }
        });
        ws.on("error", (err) => {
            log(`WebSocket error for ${connectionId}: ${err.message}`);
        });
    });
    /**
     * Handle an initial join request for a connection.
     * Does not accept non-join messages before join completes.
     */
    function handleJoin(ws, connectionId, msg, timeout, onJoined) {
        clearTimeout(timeout);
        const { partyCode, username } = msg.payload;
        // Reserved party — first joiner becomes host
        if (pendingParties.has(partyCode)) {
            pendingParties.delete(partyCode);
            const party = new Party(connectionId, ws, username);
            party.code = partyCode;
            parties.set(partyCode, party);
            orchestrators.set(partyCode, new Orchestrator(PROJECT_ROOT, MODAL_BRIDGE_URL));
            log(`${username} created and joined as host`, partyCode);
            party.sendTo(connectionId, {
                type: "join-ack",
                payload: {
                    partyCode,
                    members: party.getMemberUsernames(),
                    isHost: true,
                },
            });
            sendSystemStatus(party, connectionId);
            onJoined(party);
            return;
        }
        const party = parties.get(partyCode);
        if (!party) {
            sendRaw(ws, {
                type: "error",
                payload: {
                    message: "Party not found. Check the code and try again.",
                    code: ErrorCode.PARTY_NOT_FOUND,
                },
            });
            ws.close();
            return;
        }
        // Check max members
        if (party.members.size >= maxMembers) {
            sendRaw(ws, {
                type: "error",
                payload: {
                    message: `Party is full (${maxMembers}/${maxMembers}).`,
                    code: ErrorCode.PARTY_FULL,
                },
            });
            ws.close();
            return;
        }
        const resolvedUsername = party.addMember(ws, username, connectionId);
        log(`${resolvedUsername} joined`, partyCode);
        party.sendTo(connectionId, {
            type: "join-ack",
            payload: {
                partyCode,
                members: party.getMemberUsernames(),
                isHost: false,
            },
        });
        sendSystemStatus(party, connectionId);
        party.broadcast({ type: "member-joined", payload: { username: resolvedUsername } }, connectionId);
        party.broadcast({
            type: "activity",
            payload: {
                username: resolvedUsername,
                event: "joined",
                timestamp: Date.now(),
            },
        });
        onJoined(party);
    }
    /**
     * Handle a validated client message after join.
     * Does not process unknown message types.
     */
    function handleMessage(party, connectionId, msg) {
        switch (msg.type) {
            case "prompt-submit": {
                const entry = party.submitPrompt(connectionId, msg.payload);
                log(`Prompt queued at position ${entry.position}`, party.code);
                party.sendTo(connectionId, {
                    type: "prompt-queued",
                    payload: {
                        promptId: entry.promptId,
                        position: entry.position,
                    },
                });
                party.broadcast({
                    type: "activity",
                    payload: {
                        username: entry.username,
                        event: "submitted a prompt",
                        timestamp: Date.now(),
                    },
                });
                party.broadcast({
                    type: "member-status",
                    payload: {
                        username: entry.username,
                        status: "awaiting greenlight",
                    },
                });
                enqueueEvaluation(party, connectionId, entry);
                break;
            }
            case "host-verdict": {
                if (!party.isHost(connectionId)) {
                    party.sendTo(connectionId, {
                        type: "error",
                        payload: {
                            message: "Only host can issue verdicts",
                            code: ErrorCode.INVALID_MESSAGE,
                        },
                    });
                    return;
                }
                const { promptId, verdict, reason } = msg.payload;
                // Find the submitter connectionId for this prompt
                const promptEntry = party.promptQueue.find((p) => p.promptId === promptId);
                if (!promptEntry) {
                    party.sendTo(connectionId, {
                        type: "error",
                        payload: {
                            message: "Prompt not found for verdict",
                            code: ErrorCode.INVALID_MESSAGE,
                        },
                    });
                    return;
                }
                const submitterConnId = promptEntry.connectionId;
                const submitterName = promptEntry.username;
                if (verdict === "approve") {
                    party.sendTo(submitterConnId, {
                        type: "prompt-approved",
                        payload: { promptId },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: "host",
                            event: `approved ${submitterName}'s prompt ✓`,
                            timestamp: Date.now(),
                        },
                    });
                    party.broadcast({
                        type: "member-status",
                        payload: {
                            username: submitterName,
                            status: "executing",
                        },
                    });
                    const evaluation = pendingEvaluations.get(promptId)
                        ?? buildFallbackEvaluation(promptEntry, "Approved by host.");
                    pendingEvaluations.delete(promptId);
                    enqueueExecution(party, promptEntry, evaluation);
                }
                else {
                    party.sendTo(submitterConnId, {
                        type: "prompt-denied",
                        payload: {
                            promptId,
                            reason: reason ?? "Denied by host",
                        },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: "host",
                            event: `denied ${submitterName}'s prompt ✗`,
                            timestamp: Date.now(),
                        },
                    });
                    party.broadcast({
                        type: "member-status",
                        payload: { username: submitterName, status: "idle" },
                    });
                    pendingEvaluations.delete(promptId);
                }
                break;
            }
            case "join": {
                break;
            }
            case "status-update": {
                const member = party.getMemberByConnectionId(connectionId);
                if (member) {
                    party.broadcast({
                        type: "member-status",
                        payload: {
                            username: member.username,
                            status: msg.payload.status,
                        },
                    }, connectionId);
                }
                break;
            }
        }
    }
    /**
     * Handle a websocket disconnection.
     * Does not throw if the member was never fully joined.
     */
    function handleDisconnect(party, connectionId) {
        const member = party.getMemberByConnectionId(connectionId);
        if (!member)
            return;
        const username = member.username;
        const wasHost = party.isHost(connectionId);
        party.removeMember(connectionId);
        log(`${username} disconnected`, party.code);
        if (wasHost) {
            log("Host disconnected, ending party", party.code);
            party.broadcast({
                type: "error",
                payload: {
                    message: "Host left, party ended.",
                    code: ErrorCode.HOST_DISCONNECTED,
                },
            });
            for (const [, m] of party.members) {
                m.ws.close();
            }
            parties.delete(party.code);
            evalQueues.delete(party.code);
            pendingExecutions.delete(party.code);
            const orchestrator = orchestrators.get(party.code);
            if (orchestrator) {
                void orchestrator.shutdown();
            }
            orchestrators.delete(party.code);
            for (const prompt of party.promptQueue) {
                pendingEvaluations.delete(prompt.promptId);
            }
        }
        else {
            party.broadcast({
                type: "member-left",
                payload: { username },
            });
            party.broadcast({
                type: "activity",
                payload: {
                    username,
                    event: "disconnected",
                    timestamp: Date.now(),
                },
            });
        }
    }
    // ─── Sequential evaluation queue per party ───
    /**
     * Queue evaluations sequentially per party.
     * Does not execute prompts in parallel.
     */
    function enqueueEvaluation(party, connectionId, entry) {
        const partyCode = party.code;
        const prev = evalQueues.get(partyCode) ?? Promise.resolve();
        const next = prev.then(async () => {
            if (!parties.has(partyCode))
                return;
            try {
                const concurrent = party.promptQueue.filter((p) => p.promptId !== entry.promptId);
                const result = await evaluatePrompt(entry, concurrent, partyCode);
                if (!parties.has(partyCode))
                    return;
                if (result.verdict === "greenlit") {
                    party.sendTo(connectionId, {
                        type: "prompt-greenlit",
                        payload: {
                            promptId: entry.promptId,
                            reasoning: result.reasoning,
                        },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: entry.username,
                            event: `${entry.username}'s prompt was greenlit ✓`,
                            timestamp: Date.now(),
                        },
                    });
                    party.broadcast({
                        type: "member-status",
                        payload: {
                            username: entry.username,
                            status: "executing",
                        },
                    });
                    enqueueExecution(party, entry, result);
                }
                else {
                    party.sendTo(connectionId, {
                        type: "prompt-redlit",
                        payload: {
                            promptId: entry.promptId,
                            reasoning: result.reasoning,
                            conflicts: result.conflicts,
                        },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: entry.username,
                            event: `${entry.username}'s prompt was redlit, `
                                + "awaiting host review ⚠",
                            timestamp: Date.now(),
                        },
                    });
                    party.broadcast({
                        type: "member-status",
                        payload: {
                            username: entry.username,
                            status: "awaiting review",
                        },
                    });
                    pendingEvaluations.set(entry.promptId, result);
                    // Send host-review-request with reasoning
                    party.sendTo(party.hostId, {
                        type: "host-review-request",
                        payload: {
                            promptId: entry.promptId,
                            username: entry.username,
                            content: entry.content,
                            reasoning: result.reasoning,
                            conflicts: result.conflicts,
                        },
                    });
                }
            }
            catch (err) {
                log(`Evaluation error: ${err instanceof Error ? err.message : String(err)}`, partyCode);
            }
        });
        evalQueues.set(partyCode, next);
    }
    return wss;
}
/**
 * Build a minimal evaluation result when host approves without metadata.
 * Does not infer affected files beyond explicit scope hints.
 */
function buildFallbackEvaluation(entry, reason) {
    return {
        verdict: "greenlit",
        reasoning: reason,
        conflicts: [],
        affectedFiles: entry.scope ?? [],
        executionHints: {
            estimatedComplexity: "simple",
            requiresBuild: false,
            requiresTests: false,
            relatedContextFiles: [],
        },
    };
}
/**
 * Queue or start execution for a prompt.
 * Does not block; execution runs asynchronously.
 */
function enqueueExecution(party, entry, evaluation) {
    sendExecutionQueued(party, entry.connectionId, entry.promptId, "Waiting for execution slot...");
    if (!executionBackendAvailable && !isLocalMode()) {
        queuePendingExecution(party.code, entry, evaluation);
        return;
    }
    void runExecutionFlow(party, entry, evaluation);
}
/**
 * Store a prompt for later execution when the backend is offline.
 * Does not attempt to execute immediately.
 */
function queuePendingExecution(partyCode, entry, evaluation) {
    const queue = pendingExecutions.get(partyCode) ?? [];
    queue.push({ entry, evaluation });
    pendingExecutions.set(partyCode, queue);
}
/**
 * Drain pending execution queues when backend becomes available.
 * Does not block; executions run asynchronously.
 */
function drainPendingExecutions() {
    if (!executionBackendAvailable && !isLocalMode())
        return;
    for (const [partyCode, queue] of pendingExecutions) {
        if (queue.length === 0)
            continue;
        const party = parties.get(partyCode);
        if (!party) {
            pendingExecutions.delete(partyCode);
            continue;
        }
        pendingExecutions.set(partyCode, []);
        for (const item of queue) {
            void runExecutionFlow(party, item.entry, item.evaluation);
        }
    }
}
/**
 * Execute a prompt through the orchestrator and emit protocol messages.
 * Does not throw; errors are sent to the submitter.
 */
async function runExecutionFlow(party, entry, evaluation) {
    const orchestrator = orchestrators.get(party.code);
    if (!orchestrator) {
        party.sendTo(entry.connectionId, {
            type: "error",
            payload: {
                message: "Execution backend unavailable",
                code: ErrorCode.EXECUTION_FAILED,
            },
        });
        return;
    }
    for await (const event of orchestrator.execute(entry, evaluation)) {
        handleExecutionEvent(party, entry, event);
    }
}
/**
 * Map orchestrator events to protocol messages.
 * Does not mutate prompt queue ordering.
 */
function handleExecutionEvent(party, entry, event) {
    switch (event.type) {
        case "queued": {
            sendExecutionQueued(party, entry.connectionId, entry.promptId, event.reason ?? "Waiting for execution slot...");
            break;
        }
        case "stage": {
            if (!event.stage)
                return;
            party.sendTo(entry.connectionId, {
                type: "execution-update",
                payload: {
                    promptId: entry.promptId,
                    stage: event.stage,
                    detail: event.detail,
                },
            });
            party.broadcast({
                type: "member-execution-update",
                payload: {
                    username: entry.username,
                    promptId: entry.promptId,
                    stage: event.stage,
                },
            }, entry.connectionId);
            break;
        }
        case "complete": {
            if (!event.result)
                return;
            const summary = event.result.summary
                || buildSummary(event.result.files);
            party.sendTo(entry.connectionId, {
                type: "execution-complete",
                payload: {
                    promptId: entry.promptId,
                    files: event.result.files,
                    summary,
                },
            });
            party.broadcast({
                type: "member-execution-complete",
                payload: {
                    username: entry.username,
                    promptId: entry.promptId,
                    files: [],
                    summary,
                },
            }, entry.connectionId);
            party.broadcast({
                type: "activity",
                payload: {
                    username: entry.username,
                    event: `${entry.username}'s changes were applied (${summary})`,
                    timestamp: Date.now(),
                },
            });
            party.broadcast({
                type: "member-status",
                payload: { username: entry.username, status: "idle" },
            });
            break;
        }
        case "error": {
            party.sendTo(entry.connectionId, {
                type: "error",
                payload: {
                    message: event.message ?? "Execution failed",
                    code: ErrorCode.EXECUTION_FAILED,
                },
            });
            party.broadcast({
                type: "activity",
                payload: {
                    username: entry.username,
                    event: `${entry.username}'s execution failed`,
                    timestamp: Date.now(),
                },
            });
            party.broadcast({
                type: "member-status",
                payload: { username: entry.username, status: "idle" },
            });
            break;
        }
    }
}
/**
 * Send execution-queued to the submitter.
 * Does not change server-side execution state.
 */
function sendExecutionQueued(party, connectionId, promptId, reason) {
    party.sendTo(connectionId, {
        type: "execution-queued",
        payload: { promptId, reason },
    });
}
/**
 * Build a concise summary for activity feed.
 * Does not leak prompt content.
 */
function buildSummary(files) {
    const added = files.reduce((sum, file) => sum + file.linesAdded, 0);
    const removed = files.reduce((sum, file) => sum + file.linesRemoved, 0);
    return `${files.length} files, +${added}/-${removed}`;
}
// ─── Helpers ───
function sendRaw(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
/**
 * Gracefully shut down all parties and bridge processes.
 * Sends PARTY_ENDED before closing sockets and stopping orchestrators.
 */
export function shutdownAllParties() {
    for (const [code, party] of parties) {
        log("Shutting down party", code);
        party.broadcast({
            type: "error",
            payload: {
                message: "Server shutting down",
                code: ErrorCode.PARTY_ENDED,
            },
        });
        for (const [, m] of party.members) {
            m.ws.close();
        }
        const orchestrator = orchestrators.get(code);
        if (orchestrator) {
            void orchestrator.shutdown();
        }
    }
    parties.clear();
    pendingParties.clear();
    evalQueues.clear();
    pendingExecutions.clear();
    pendingEvaluations.clear();
    orchestrators.clear();
    if (bridgeHealthTimer) {
        clearInterval(bridgeHealthTimer);
        bridgeHealthTimer = null;
    }
    if (bridgeProcess) {
        bridgeProcess.kill();
        bridgeProcess = null;
    }
}
//# sourceMappingURL=index.js.map