// Purpose: Manage a client session and route server messages.
// Behavior: Connects to the server, sends join payload, and logs output.
// Assumptions: The caller provides a validated GitHub repository slug.
// Invariants: Connection lifecycle is deterministic and reconnect-safe.
import { Connection } from "./connection.js";
import { DEFAULT_PORT } from "../shared/constants.js";
export class Session {
    connection;
    partyCode;
    username;
    repository;
    silent;
    constructor(options) {
        const host = options.host ?? "localhost";
        const port = options.port ?? DEFAULT_PORT;
        this.partyCode = options.partyCode;
        this.username = options.username;
        this.repository = options.repository;
        this.silent = options.silent ?? false;
        this.connection = new Connection({
            url: `ws://${host}:${port}`,
        });
        this.setupHandlers();
    }
    setupHandlers() {
        this.connection.on("connected", () => {
            if (!this.silent)
                console.log("[session] Connected to server");
            // Send join message
            this.connection.send({
                type: "join",
                payload: {
                    partyCode: this.partyCode,
                    username: this.username,
                    repository: this.repository,
                },
            });
        });
        this.connection.on("disconnected", () => {
            if (!this.silent)
                console.log("[session] Disconnected");
        });
        this.connection.on("reconnecting", (delay) => {
            if (!this.silent)
                console.log(`[session] Reconnecting in ${delay}ms...`);
        });
        this.connection.onMessage((msg) => {
            this.handleServerMessage(msg);
        });
    }
    handleServerMessage(msg) {
        if (this.silent) {
            // In UI mode, only handle terminal error logic
            if (msg.type === "error") {
                const terminalCodes = [
                    "PARTY_ENDED",
                    "PARTY_NOT_FOUND",
                    "JOIN_TIMEOUT",
                    "HOST_DISCONNECTED",
                    "PARTY_FULL",
                    "REPO_INVALID",
                    "REPO_MISMATCH",
                ];
                if (terminalCodes.includes(msg.payload.code)) {
                    this.connection.stopReconnecting();
                }
            }
            return;
        }
        // Console fallback (Phase 1 behavior)
        switch (msg.type) {
            case "join-ack":
                console.log(`[party] Joined ${msg.payload.partyCode}`);
                console.log(`[party] Members: ${msg.payload.members.join(", ")}`);
                console.log(`[party] Is host: ${msg.payload.isHost}`);
                break;
            case "member-joined":
                console.log(`[party] ${msg.payload.username} joined`);
                break;
            case "member-left":
                console.log(`[party] ${msg.payload.username} left`);
                break;
            case "member-status":
                console.log(`[status] ${msg.payload.username}: ${msg.payload.status}`);
                break;
            case "prompt-queued":
                console.log(`[prompt] Queued at position ${msg.payload.position}`);
                break;
            case "prompt-approved":
                console.log(`[prompt] Approved: ${msg.payload.promptId}`);
                break;
            case "prompt-denied":
                console.log(`[prompt] Denied: ${msg.payload.reason}`);
                break;
            case "host-review-request":
                console.log(`[host] Review request from ${msg.payload.username}`);
                console.log(`[host] Content: ${msg.payload.content}`);
                break;
            case "activity":
                console.log(`[activity] ${msg.payload.username}: ${msg.payload.event}`);
                break;
            case "error": {
                console.error(`[error] ${msg.payload.code}: ${msg.payload.message}`);
                const terminalCodes = [
                    "PARTY_ENDED",
                    "PARTY_NOT_FOUND",
                    "JOIN_TIMEOUT",
                    "HOST_DISCONNECTED",
                    "PARTY_FULL",
                    "REPO_INVALID",
                    "REPO_MISMATCH",
                ];
                if (terminalCodes.includes(msg.payload.code)) {
                    this.connection.stopReconnecting();
                }
                break;
            }
            case "execution-queued":
                console.log(`[exec] Queued: ${msg.payload.reason}`);
                break;
            case "execution-update":
                console.log(`[exec] Stage: ${msg.payload.stage}`);
                break;
            case "execution-complete":
                console.log(`[exec] Complete: ${msg.payload.summary}`);
                for (const f of msg.payload.files) {
                    console.log(`[exec]   ${f.path} (+${f.linesAdded}/-${f.linesRemoved})`);
                }
                break;
            case "system-status":
                if (!msg.payload.executionBackendAvailable) {
                    console.log(`[system] ⚠ Execution backend unavailable`);
                }
                break;
        }
    }
    connect() {
        this.connection.connect();
    }
    disconnect() {
        this.connection.disconnect();
    }
    submitPrompt(promptId, content, scope) {
        this.connection.send({
            type: "prompt-submit",
            payload: { promptId, content, scope },
        });
    }
    sendVerdict(promptId, verdict, reason) {
        this.connection.send({
            type: "host-verdict",
            payload: { promptId, verdict, reason },
        });
    }
    sendStatusUpdate(status) {
        this.connection.send({
            type: "status-update",
            payload: { status },
        });
    }
}
//# sourceMappingURL=session.js.map