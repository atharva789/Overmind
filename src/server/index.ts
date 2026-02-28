import { WebSocketServer, WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import { Party } from "./party.js";
import type { PromptEntry } from "./party.js";
import { parseClientMessage } from "../shared/protocol.js";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import {
    DEFAULT_PORT,
    JOIN_TIMEOUT_MS,
    CONNECTION_ID_LENGTH,
    PARTY_CODE_ALPHABET,
    PARTY_CODE_LENGTH,
    MAX_MEMBERS_DEFAULT,
    ErrorCode,
} from "../shared/constants.js";
import { evaluatePrompt, greenlightLog } from "./greenlight/agent.js";
import { executePromptChanges } from "./execution/agent.js";
import { Orchestrator } from "./orchestrator/index.js";
import type { EvaluationResult as OrchestratorEvaluation } from "./orchestrator/index.js";
import { MODAL_BRIDGE_URL } from "../shared/constants.js";

const generateConnectionId = customAlphabet(
    "abcdefghijklmnopqrstuvwxyz0123456789",
    CONNECTION_ID_LENGTH
);

const generatePartyCode = customAlphabet(PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH);

// ─── State ───

const parties: Map<string, Party> = new Map();
const evalQueues: Map<string, Promise<void>> = new Map();
const execQueues: Map<string, Promise<void>> = new Map();
const pendingParties: Map<string, string> = new Map();

let maxMembers = MAX_MEMBERS_DEFAULT;

// Modal orchestrator instance (null = local mode)
const useModal = process.env["OVERMIND_LOCAL"] !== "1";
let orchestrator: Orchestrator | null = null;
if (useModal) {
    const projectRoot = process.env["OVERMIND_PROJECT_ROOT"] ?? process.cwd();
    orchestrator = new Orchestrator(projectRoot, MODAL_BRIDGE_URL);
}

export function setMaxMembers(n: number): void {
    maxMembers = n;
}

// ─── Logging ───

function log(msg: string, partyCode?: string): void {
    const ts = new Date().toISOString();
    const prefix = partyCode ? `[${ts}] [${partyCode}]` : `[${ts}]`;
    console.log(`${prefix} ${msg}`);
}

// ─── Public API ───

export function reserveParty(hostUsername: string): string {
    const code = generatePartyCode();
    pendingParties.set(code, hostUsername);
    log("Party reserved", code);
    return code;
}

// ─── Server ───

export function startServer(): WebSocketServer {
    const port = Number(process.env["OVERMIND_PORT"]) || DEFAULT_PORT;

    const wss = new WebSocketServer({ port, host: "0.0.0.0" }, () => {
        log(`Overmind server listening on port ${port} (0.0.0.0)`);
    });

    wss.on("connection", (ws: WebSocket) => {
        const connectionId = generateConnectionId();
        let joined = false;
        let partyRef: Party | null = null;

        const joinTimeout = setTimeout(() => {
            if (!joined) {
                sendRaw(ws, {
                    type: "error",
                    payload: { message: "Join timeout", code: ErrorCode.JOIN_TIMEOUT },
                });
                ws.close();
            }
        }, JOIN_TIMEOUT_MS);

        ws.on("message", (raw: Buffer | string) => {
            const data = typeof raw === "string" ? raw : raw.toString("utf-8");
            const msg = parseClientMessage(data);

            if (!msg) {
                log(`Invalid message from ${connectionId}`);
                sendRaw(ws, {
                    type: "error",
                    payload: { message: "Invalid message", code: ErrorCode.INVALID_MESSAGE },
                });
                return;
            }

            if (!joined) {
                if (msg.type !== "join") {
                    sendRaw(ws, {
                        type: "error",
                        payload: { message: "Must join first", code: ErrorCode.INVALID_MESSAGE },
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

        ws.on("error", (err: Error) => {
            log(`WebSocket error for ${connectionId}: ${err.message}`);
        });
    });

    function handleJoin(
        ws: WebSocket,
        connectionId: string,
        msg: ClientMessage & { type: "join" },
        timeout: NodeJS.Timeout,
        onJoined: (party: Party) => void
    ): void {
        clearTimeout(timeout);
        const { partyCode, username } = msg.payload;

        // Reserved party — first joiner becomes host
        if (pendingParties.has(partyCode)) {
            pendingParties.delete(partyCode);
            const party = new Party(connectionId, ws, username);
            (party as { code: string }).code = partyCode;
            parties.set(partyCode, party);
            log(`${username} created and joined as host`, partyCode);

            party.sendTo(connectionId, {
                type: "join-ack",
                payload: {
                    partyCode,
                    members: party.getMemberUsernames(),
                    isHost: true,
                },
            });

            // Send system status
            party.sendTo(connectionId, {
                type: "system-status",
                payload: { greenlightAvailable: true, executionBackendAvailable: true },
            });

            onJoined(party);
            return;
        }

        const party = parties.get(partyCode);
        if (!party) {
            sendRaw(ws, {
                type: "error",
                payload: { message: "Party not found. Check the code and try again.", code: ErrorCode.PARTY_NOT_FOUND },
            });
            ws.close();
            return;
        }

        // Check max members
        if (party.members.size >= maxMembers) {
            sendRaw(ws, {
                type: "error",
                payload: { message: `Party is full (${maxMembers}/${maxMembers}).`, code: ErrorCode.PARTY_FULL },
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

        // Send system status to new member
        party.sendTo(connectionId, {
            type: "system-status",
            payload: { greenlightAvailable: true, executionBackendAvailable: true },
        });

        party.broadcast(
            { type: "member-joined", payload: { username: resolvedUsername } },
            connectionId
        );

        party.broadcast({
            type: "activity",
            payload: { username: resolvedUsername, event: "joined", timestamp: Date.now() },
        });

        onJoined(party);
    }

    function handleMessage(party: Party, connectionId: string, msg: ClientMessage): void {
        switch (msg.type) {
            case "prompt-submit": {
                const entry = party.submitPrompt(connectionId, msg.payload);
                log(`Prompt queued at position ${entry.position}`, party.code);

                party.sendTo(connectionId, {
                    type: "prompt-queued",
                    payload: { promptId: entry.promptId, position: entry.position },
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
                    payload: { username: entry.username, status: "awaiting greenlight" },
                });

                enqueueEvaluation(party, connectionId, entry);
                break;
            }

            case "host-verdict": {
                if (!party.isHost(connectionId)) {
                    party.sendTo(connectionId, {
                        type: "error",
                        payload: { message: "Only host can issue verdicts", code: ErrorCode.INVALID_MESSAGE },
                    });
                    return;
                }

                const { promptId, verdict, reason } = msg.payload;

                // Find the submitter connectionId for this prompt
                const promptEntry = party.promptQueue.find((p) => p.promptId === promptId);
                const submitterConnId = promptEntry?.connectionId;

                if (verdict === "approve") {
                    if (submitterConnId) {
                        party.sendTo(submitterConnId, {
                            type: "prompt-approved",
                            payload: { promptId },
                        });
                    }

                    const submitterName = promptEntry?.username ?? "unknown";
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: "host",
                            event: `approved ${submitterName}'s prompt ✓`,
                            timestamp: Date.now(),
                        },
                    });

                    // Trigger execution simulation for approved prompt
                    if (submitterConnId && promptEntry) {
                        party.broadcast({
                            type: "member-status",
                            payload: { username: submitterName, status: "executing" },
                        });
                        enqueueExecution(party, submitterConnId, promptEntry);
                    }
                } else {
                    if (submitterConnId) {
                        party.sendTo(submitterConnId, {
                            type: "prompt-denied",
                            payload: { promptId, reason: reason ?? "Denied by host" },
                        });
                    }

                    const submitterName = promptEntry?.username ?? "unknown";
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
                        payload: { username: member.username, status: msg.payload.status },
                    }, connectionId);
                }
                break;
            }
        }
    }

    function handleDisconnect(party: Party, connectionId: string): void {
        const member = party.getMemberByConnectionId(connectionId);
        if (!member) return;

        const username = member.username;
        const wasHost = party.isHost(connectionId);

        party.removeMember(connectionId);
        log(`${username} disconnected`, party.code);

        if (wasHost) {
            log("Host disconnected, ending party", party.code);
            party.broadcast({
                type: "error",
                payload: { message: "Host left, party ended.", code: ErrorCode.HOST_DISCONNECTED },
            });

            for (const [, m] of party.members) {
                m.ws.close();
            }
            parties.delete(party.code);
            evalQueues.delete(party.code);
            execQueues.delete(party.code);
        } else {
            party.broadcast({
                type: "member-left",
                payload: { username },
            });
            party.broadcast({
                type: "activity",
                payload: { username, event: "disconnected", timestamp: Date.now() },
            });
        }
    }

    // ─── Sequential evaluation queue per party ───

    function enqueueEvaluation(
        party: Party,
        connectionId: string,
        entry: PromptEntry
    ): void {
        const partyCode = party.code;
        const prev = evalQueues.get(partyCode) ?? Promise.resolve();

        const next = prev.then(async () => {
            if (!parties.has(partyCode)) return;

            try {
                const concurrent = party.promptQueue.filter(
                    (p) => p.promptId !== entry.promptId
                );

                const result = await evaluatePrompt(entry, concurrent, partyCode);
                if (!parties.has(partyCode)) return;

                if (result.verdict === "greenlit") {
                    party.sendTo(connectionId, {
                        type: "prompt-greenlit",
                        payload: { promptId: entry.promptId, reasoning: result.reasoning },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: entry.username,
                            event: `'s prompt was greenlit ✓`,
                            timestamp: Date.now(),
                        },
                    });

                    party.broadcast({
                        type: "member-status",
                        payload: { username: entry.username, status: "executing" },
                    });

                    // Greenlit → auto-trigger execution simulation
                    enqueueExecution(party, connectionId, entry);
                } else {
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
                            event: `'s prompt was redlit, awaiting host review ⚠`,
                            timestamp: Date.now(),
                        },
                    });

                    party.broadcast({
                        type: "member-status",
                        payload: { username: entry.username, status: "awaiting review" },
                    });

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
            } catch (err) {
                log(`Evaluation error: ${err instanceof Error ? err.message : String(err)}`, partyCode);
            }
        });

        evalQueues.set(partyCode, next);
    }

    // ─── Sequential execution queue per party (Modal or local) ───

    function enqueueExecution(
        party: Party,
        connectionId: string,
        entry: PromptEntry
    ): void {
        const partyCode = party.code;
        const prev = execQueues.get(partyCode) ?? Promise.resolve();

        const next = prev.then(async () => {
            if (!parties.has(partyCode)) return;

            // Send execution-queued
            party.sendTo(connectionId, {
                type: "execution-queued",
                payload: { promptId: entry.promptId, reason: "Waiting for execution agent slot..." },
            });

            await sleep(300);

            if (!parties.has(partyCode)) return;

            if (orchestrator) {
                // ─── Modal execution path ───
                const evaluation: OrchestratorEvaluation = {
                    affectedFiles: entry.scope ?? [],
                    executionHints: {
                        requiresBuild: false,
                        requiresTests: false,
                    },
                };

                for await (const event of orchestrator.execute(entry, evaluation)) {
                    if (!parties.has(partyCode)) return;

                    switch (event.type) {
                        case "stage":
                            party.sendTo(connectionId, {
                                type: "execution-update",
                                payload: { promptId: entry.promptId, stage: event.stage, detail: event.detail },
                            });
                            party.broadcast({
                                type: "member-execution-update",
                                payload: { username: entry.username, promptId: entry.promptId, stage: event.stage },
                            });
                            break;

                        case "complete": {
                            const totalAdded = event.result.files.reduce((sum, f) => sum + f.linesAdded, 0);
                            const totalRemoved = event.result.files.reduce((sum, f) => sum + f.linesRemoved, 0);
                            const summaryMsg = event.result.summary;

                            party.sendTo(connectionId, {
                                type: "execution-complete",
                                payload: {
                                    promptId: entry.promptId,
                                    files: event.result.files,
                                    summary: summaryMsg,
                                },
                            });
                            party.broadcast({
                                type: "member-execution-complete",
                                payload: {
                                    username: entry.username,
                                    promptId: entry.promptId,
                                    files: event.result.files,
                                    summary: summaryMsg,
                                },
                            });
                            party.broadcast({
                                type: "activity",
                                payload: {
                                    username: entry.username,
                                    event: `'s changes were applied (${event.result.files.length} files, +${totalAdded}/-${totalRemoved})`,
                                    timestamp: Date.now(),
                                },
                            });
                            break;
                        }

                        case "error":
                            party.sendTo(connectionId, {
                                type: "error",
                                payload: { message: `Execution failed: ${event.message}`, code: ErrorCode.INVALID_MESSAGE },
                            });
                            break;

                        case "agent-output":
                        case "files-changed":
                            // Consumed internally, not sent to clients in v1
                            break;
                    }
                }
            } else {
                // ─── Local execution path (Gemini) ───
                party.sendTo(connectionId, {
                    type: "execution-update",
                    payload: { promptId: entry.promptId, stage: "Agent is working..." },
                });
                party.broadcast({
                    type: "member-execution-update",
                    payload: { username: entry.username, promptId: entry.promptId, stage: "Agent is working..." },
                });

                const result = await executePromptChanges(entry, partyCode, greenlightLog);

                if (!parties.has(partyCode)) return;

                if (result.success) {
                    const totalAdded = result.files.reduce((sum, f) => sum + f.linesAdded, 0);
                    const totalRemoved = result.files.reduce((sum, f) => sum + f.linesRemoved, 0);
                    const summaryMsg = `Applied ${result.files.length} files (+${totalAdded}/-${totalRemoved}).`;

                    party.sendTo(connectionId, {
                        type: "execution-complete",
                        payload: {
                            promptId: entry.promptId,
                            files: result.files,
                            summary: summaryMsg,
                        },
                    });
                    party.broadcast({
                        type: "member-execution-complete",
                        payload: {
                            username: entry.username,
                            promptId: entry.promptId,
                            files: result.files,
                            summary: summaryMsg,
                        },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: entry.username,
                            event: `'s changes were applied (${result.files.length} files, +${totalAdded}/-${totalRemoved})`,
                            timestamp: Date.now(),
                        },
                    });
                } else {
                    party.sendTo(connectionId, {
                        type: "error",
                        payload: { message: `Execution failed: ${result.summary}`, code: ErrorCode.INVALID_MESSAGE },
                    });
                }
            }

            party.broadcast({
                type: "member-status",
                payload: { username: entry.username, status: "idle" },
            });
        });

        execQueues.set(partyCode, next);
    }

    return wss;
}

// ─── Helpers ───

function sendRaw(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gracefully shut down all parties: send PARTY_ENDED to all members,
 * then close all sockets. Call this before wss.close().
 */
export function shutdownAllParties(): void {
    for (const [code, party] of parties) {
        log("Shutting down party", code);
        party.broadcast({
            type: "error",
            payload: { message: "Server shutting down", code: ErrorCode.PARTY_ENDED },
        });

        for (const [, m] of party.members) {
            m.ws.close();
        }
    }
    parties.clear();
    pendingParties.clear();
    evalQueues.clear();
    execQueues.clear();
}
