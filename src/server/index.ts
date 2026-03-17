/**
 * Purpose: Start and manage the WebSocket server and party lifecycle.
 * High-level behavior: Handles joins, prompt evaluation, and execution.
 * Assumptions: startServer is called by the host CLI process.
 * Invariants: Prompt content is never broadcast to non-host members.
 */

import { WebSocketServer, WebSocket } from "ws";
import { deriveProjectId } from "../shared/project-id.js";
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
    BRIDGE_HEALTH_INTERVAL_MS,
    OVERMIND_ORCHESTRATOR_URL,
    ErrorCode,
} from "../shared/constants.js";
import type { EvaluationResult } from "../shared/protocol.js";
import { Orchestrator, type ExecutionEvent } from "./orchestrator/index.js";
import { initDb, pool } from "./db.js";
import { checkAndRunStoryAgent } from "./story/agent.js";
import { solveMergeConflicts } from "./merge/index.js";
import { extractScope } from "./execution/scope.js";

const generateConnectionId = customAlphabet(
    "abcdefghijklmnopqrstuvwxyz0123456789",
    CONNECTION_ID_LENGTH
);

const generatePartyCode = customAlphabet(
    PARTY_CODE_ALPHABET,
    PARTY_CODE_LENGTH
);

// ─── State ───

const PROJECT_ROOT = process.env["OVERMIND_PROJECT_ROOT"] ?? process.cwd();
const parties: Map<string, Party> = new Map();
const evalQueues: Map<string, Promise<void>> = new Map();
const pendingParties: Map<string, string> = new Map();
const orchestrators: Map<string, Orchestrator> = new Map();
const pendingEvaluations: Map<string, EvaluationResult> = new Map();
const pendingExecutions: Map<string, PendingExecution[]> = new Map();

let maxMembers = MAX_MEMBERS_DEFAULT;
let executionBackendAvailable = false;
let healthTimer: NodeJS.Timeout | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PendingExecution {
    entry: PromptEntry;
    evaluation: EvaluationResult;
}



/**
 * Configure the max members allowed per party.
 * Does not retroactively remove existing members.
 */
export function setMaxMembers(n: number): void {
    maxMembers = n;
}

// ─── Logging ───

function log(msg: string, partyCode?: string): void {
    const ts = new Date().toISOString();
    const prefix = partyCode ? `[${ts}] [${partyCode}]` : `[${ts}]`;
    console.log(`${prefix} ${msg}`);
}

/**
 * Decide whether remote orchestrator mode is enabled.
 * Does not validate the URL.
 */
function isOrchestratorEnabled(): boolean {
    return OVERMIND_ORCHESTRATOR_URL().trim().length > 0;
}

/**
 * Build the /health endpoint for the remote orchestrator.
 * Does not perform network calls.
 */
function buildRemoteOrchestratorHealthUrl(): string {
    const trimmed = OVERMIND_ORCHESTRATOR_URL().replace(/\/+$/u, "");
    const runSuffix = "/runs";
    const executeSuffix = "/execute";
    if (trimmed.endsWith(runSuffix)) {
        return `${trimmed.slice(0, -runSuffix.length)}/health`;
    }
    if (trimmed.endsWith(executeSuffix)) {
        return `${trimmed.slice(0, -executeSuffix.length)}/health`;
    }
    return `${trimmed}/health`;
}

/**
 * Update execution backend availability and broadcast to members.
 * Does not perform any health checks itself.
 */
function setExecutionBackendAvailable(value: boolean): void {
    if (executionBackendAvailable === value) return;
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
function sendSystemStatus(party: Party, connectionId: string): void {
    party.sendTo(connectionId, {
        type: "system-status",
        payload: {
            executionBackendAvailable:
                executionBackendAvailable,
        },
    });
}

/**
 * Broadcast system availability status to all members.
 * Does not mutate party membership.
 */
function broadcastSystemStatus(): void {
    for (const [, party] of parties) {
        party.broadcast({
            type: "system-status",
            payload: {
                executionBackendAvailable:
                    executionBackendAvailable,
            },
        });
    }
}

/**
 * Start health checks for the remote orchestrator.
 * Does not throw; failures mark execution backend unavailable.
 */
async function initOrchestratorHealth(): Promise<void> {
    if (!isOrchestratorEnabled()) {
        log("No OVERMIND_ORCHESTRATOR_URL configured — execution unavailable");
        setExecutionBackendAvailable(false);
        return;
    }

    await checkOrchestratorHealth();

    if (healthTimer) {
        clearInterval(healthTimer);
    }

    healthTimer = setInterval(() => {
        void checkOrchestratorHealth();
    }, BRIDGE_HEALTH_INTERVAL_MS);
}

/**
 * Check remote orchestrator health and update availability.
 * Does not throw; failures mark execution unavailable.
 */
async function checkOrchestratorHealth(): Promise<void> {
    const url = buildRemoteOrchestratorHealthUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { llm_connected?: boolean };
        setExecutionBackendAvailable(Boolean(data.llm_connected));
    } catch (err) {
        log(`Remote orchestrator health check failed: ${String(err)}`);
        setExecutionBackendAvailable(false);
    } finally {
        clearTimeout(timer);
    }
}

// ─── Public API ───

export function reserveParty(hostUsername: string): string {
    const code = generatePartyCode();
    pendingParties.set(code, hostUsername);
    log("Party reserved", code);
    return code;
}

// ─── Server ───

/**
 * Start the WebSocket server and initialize orchestrator health checks.
 * Does not block on health checks; runs asynchronously.
 */
export function startServer(): WebSocketServer {
    const port = Number(process.env["OVERMIND_PORT"]) || DEFAULT_PORT;
    void initOrchestratorHealth();

    initDb()
        .then(() => {
            const projectRoot = process.env["OVERMIND_PROJECT_ROOT"] ?? process.cwd();
            checkAndRunStoryAgent(projectRoot).catch(err => console.error("[story-agent] Startup error:", err));
        })
        .catch((err) => {
            console.error("Failed to initialize database", err);
            process.exit(1);
        });

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
                    payload: {
                        message: "Join timeout",
                        code: ErrorCode.JOIN_TIMEOUT,
                    },
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

        ws.on("error", (err: Error) => {
            log(`WebSocket error for ${connectionId}: ${err.message}`);
        });
    });

    /**
     * Handle an initial join request for a connection.
     * Does not accept non-join messages before join completes.
     */
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
            orchestrators.set(
                partyCode,
                new Orchestrator(PROJECT_ROOT)
            );
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

        party.broadcast(
            { type: "member-joined", payload: { username: resolvedUsername } },
            connectionId
        );

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
    function handleMessage(
        party: Party,
        connectionId: string,
        msg: ClientMessage
    ): void {
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
                const promptEntry = party.promptQueue.find(
                    (p) => p.promptId === promptId
                );
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
                        ?? buildFallbackEvaluation(
                            promptEntry,
                            "Approved by host."
                        );
                    pendingEvaluations.delete(promptId);
                    enqueueExecution(party, promptEntry, evaluation);
                } else {
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

            case "merge-request": {
                if (!party.isHost(connectionId)) {
                    party.sendTo(connectionId, {
                        type: "error",
                        payload: {
                            message: "Only host can trigger merge",
                            code: ErrorCode.INVALID_MESSAGE,
                        },
                    });
                    return;
                }

                const projectRoot = process.env["OVERMIND_PROJECT_ROOT"] ?? process.cwd();
                void (async () => {
                    try {
                        for await (const event of solveMergeConflicts(
                            { conflictingFiles: [], storyMd: "", partyCode: party.code },
                            projectRoot
                        )) {
                            switch (event.type) {
                                case "stage":
                                    party.sendTo(connectionId, {
                                        type: "merge-update" as any,
                                        payload: { stage: event.stage },
                                    });
                                    break;
                                case "complete": {
                                    const result = event.result!;
                                    party.sendTo(connectionId, {
                                        type: "merge-complete" as any,
                                        payload: {
                                            filesResolved: result.resolutions.length,
                                            prUrl: result.prUrl,
                                            hasLowConfidence: result.hasLowConfidence,
                                            branchName: result.branchName,
                                            summary: result.prDescription,
                                        },
                                    });
                                    party.broadcast({
                                        type: "activity",
                                        payload: {
                                            username: "system",
                                            event: `Merge complete: ${result.resolutions.length} file(s) resolved${result.prUrl ? ` — PR: ${result.prUrl}` : ""}`,
                                            timestamp: Date.now(),
                                        },
                                    });
                                    break;
                                }
                                case "error":
                                    party.sendTo(connectionId, {
                                        type: "merge-error" as any,
                                        payload: { message: event.message },
                                    });
                                    break;
                            }
                        }
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        party.sendTo(connectionId, {
                            type: "merge-error" as any,
                            payload: { message: msg },
                        });
                    }
                })();
                break;
            }

            case "join": {
                break;
            }

            case "status-update": {
                const member = party.getMemberByConnectionId(connectionId);
                if (member) {
                    party.broadcast(
                        {
                            type: "member-status",
                            payload: {
                                username: member.username,
                                status: msg.payload.status,
                            },
                        },
                        connectionId
                    );
                }
                break;
            }
        }
    }

    /**
     * Handle a websocket disconnection.
     * Does not throw if the member was never fully joined.
     */
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
        } else {
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

    return wss;

    /**
     * Queue evaluations sequentially per party.
     * Does not execute prompts in parallel.
     */
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
                const projectRoot = process.env["OVERMIND_PROJECT_ROOT"] ?? process.cwd();
                const projectId = deriveProjectId(projectRoot);

                // Insert into DB
                const insertRes: any = await pool.query(
                    "INSERT INTO queries (project_id, content, username) VALUES ($1, $2, $3) RETURNING id",
                    [projectId, entry.content, entry.username]
                );
                const queryId = insertRes.rows[0].id;

                const results = await checkAndRunStoryAgent(projectRoot) || [];
                const featureResult = results.find(r => r.queryId === queryId);

                // 2-second UI delay to let the user see their prompt
                await sleep(2000);

                // Handle rejected (off-topic) queries — send redlit and skip execution
                if (featureResult?.type === "rejected") {
                    party.sendTo(connectionId, {
                        type: "prompt-redlit",
                        payload: {
                            promptId: entry.promptId,
                            reasoning: featureResult.reason ?? "Query is off-topic for this project.",
                            conflicts: [],
                        },
                    });
                    party.broadcast({
                        type: "activity",
                        payload: {
                            username: entry.username,
                            event: `'s prompt was rejected ✗`,
                            timestamp: Date.now(),
                        },
                    });
                    return;
                }

                if (featureResult?.type === "new_feature") {
                    party.sendTo(connectionId, {
                        type: "feature-created",
                        payload: { promptId: entry.promptId, title: featureResult.title! },
                    });
                } else {
                    party.sendTo(connectionId, {
                        type: "prompt-greenlit",
                        payload: { promptId: entry.promptId, reasoning: "Prompt securely recorded in project memory." },
                    });
                }

                party.broadcast({
                    type: "activity",
                    payload: {
                        username: entry.username,
                        event: `'s prompt was accepted ✓`,
                        timestamp: Date.now(),
                    },
                });

                party.broadcast({
                    type: "member-status",
                    payload: { username: entry.username, status: "executing" },
                });

                // Extract scope from prompt to identify affected files
                const scope = await extractScope(entry.content, projectRoot);
                const evaluationResult: EvaluationResult = {
                    verdict: "greenlit",
                    reasoning: "Prompt securely recorded in project memory.",
                    conflicts: [],
                    affectedFiles: scope.affectedFiles,
                    executionHints: {
                        estimatedComplexity: scope.complexity,
                        requiresBuild: false,
                        requiresTests: false,
                        relatedContextFiles: [],
                    },
                };
                enqueueExecution(party, entry, evaluationResult);
            } catch (err) {
                const errorMessage = err instanceof Error
                    ? err.message
                    : String(err);
                log(`Database insert/evaluation error: ${errorMessage}`, partyCode);
            }
        });

        evalQueues.set(partyCode, next);
    }
}

// ─── Sequential execution queue per party ───
/**
 * Build a minimal evaluation result when host approves without metadata.
 * Does not infer affected files beyond explicit scope hints.
 */
function buildFallbackEvaluation(
    entry: PromptEntry,
    reason: string
): EvaluationResult {
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
function enqueueExecution(
    party: Party,
    entry: PromptEntry,
    evaluation: EvaluationResult
): void {
    sendExecutionQueued(
        party,
        entry.connectionId,
        entry.promptId,
        "Waiting for execution slot..."
    );

    // Let the greenlight verdict UI linger for 1.2 seconds
    setTimeout(() => {
        if (!executionBackendAvailable) {
            queuePendingExecution(party.code, entry, evaluation);
            return;
        }

        void runExecutionFlow(party, entry, evaluation);
    }, 1200);
}

/**
 * Store a prompt for later execution when the backend is offline.
 * Does not attempt to execute immediately.
 */
function queuePendingExecution(
    partyCode: string,
    entry: PromptEntry,
    evaluation: EvaluationResult
): void {
    const queue = pendingExecutions.get(partyCode) ?? [];
    queue.push({ entry, evaluation });
    pendingExecutions.set(partyCode, queue);
}

/**
 * Drain pending execution queues when backend becomes available.
 * Does not block; executions run asynchronously.
 */
function drainPendingExecutions(): void {
    if (!executionBackendAvailable) return;

    for (const [partyCode, queue] of pendingExecutions) {
        if (queue.length === 0) continue;
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
async function runExecutionFlow(
    party: Party,
    entry: PromptEntry,
    evaluation: EvaluationResult
): Promise<void> {
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
function handleExecutionEvent(
    party: Party,
    entry: PromptEntry,
    event: ExecutionEvent
): void {
    switch (event.type) {
        case "queued": {
            sendExecutionQueued(
                party,
                entry.connectionId,
                entry.promptId,
                event.reason ?? "Waiting for execution slot..."
            );
            break;
        }

        case "stage": {
            if (!event.stage) return;
            party.sendTo(entry.connectionId, {
                type: "execution-update",
                payload: {
                    promptId: entry.promptId,
                    stage: event.stage,
                    detail: event.detail,
                },
            });
            party.broadcast(
                {
                    type: "member-execution-update",
                    payload: {
                        username: entry.username,
                        promptId: entry.promptId,
                        stage: event.stage,
                    },
                },
                entry.connectionId
            );
            break;
        }

        case "complete": {
            if (!event.result) return;
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

            party.broadcast(
                {
                    type: "member-execution-complete",
                    payload: {
                        username: entry.username,
                        promptId: entry.promptId,
                        files: [],
                        summary,
                    },
                },
                entry.connectionId
            );

            party.broadcast({
                type: "activity",
                payload: {
                    username: entry.username,
                    event:
                        `${entry.username}'s changes were applied (${summary})`,
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
function sendExecutionQueued(
    party: Party,
    connectionId: string,
    promptId: string,
    reason: string
): void {
    party.sendTo(connectionId, {
        type: "execution-queued",
        payload: { promptId, reason },
    });
}

/**
 * Build a concise summary for activity feed.
 * Does not leak prompt content.
 */
function buildSummary(
    files: Array<{ linesAdded: number; linesRemoved: number }>
): string {
    const added = files.reduce((sum, file) => sum + file.linesAdded, 0);
    const removed = files.reduce((sum, file) => sum + file.linesRemoved, 0);
    return `${files.length} files, +${added}/-${removed}`;
}

// ─── Helpers ───

function sendRaw(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

/**
 * Gracefully shut down all parties and bridge processes.
 * Sends PARTY_ENDED before closing sockets and stopping orchestrators.
 */
export function shutdownAllParties(): void {
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

    if (healthTimer) {
        clearInterval(healthTimer);
        healthTimer = null;
    }
}
