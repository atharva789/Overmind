/**
 * Purpose: Manages all mutable state for a single Overmind party.
 *
 * High-level behavior: The Party class owns the member map, the FIFO
 * prompt queue, and all messaging primitives (broadcast / sendTo). It
 * enforces username uniqueness via suffix resolution and designates the
 * first member added as the host.
 *
 * Assumptions:
 *  - addMember is always called with a live, OPEN WebSocket.
 *  - connectionId values are unique across all active parties.
 *  - submitPrompt is called only for known connectionIds.
 *
 * Invariants:
 *  - Exactly one host per party (first addMember call sets hostId).
 *  - All usernames within a party are unique.
 *  - promptQueue is strictly FIFO; no reordering occurs here.
 *  - Prompt content is never broadcast by this class; callers decide.
 */
import { WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "../shared/constants.js";
const generatePartyCode = customAlphabet(PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH);
export class Party {
    code;
    hostId = null;
    members = new Map(); // connectionId → Member
    promptQueue = [];
    constructor(code) {
        this.code = code ?? generatePartyCode();
    }
    // ─── Member Management ───────────────────────────────────────────────────────
    /** Add a member. The first member added becomes the host. Returns connectionId. */
    addMember(ws, username, connectionId) {
        const resolvedUsername = this._resolveUsername(username);
        this.members.set(connectionId, { connectionId, username: resolvedUsername, ws });
        if (this.hostId === null) {
            this.hostId = connectionId;
        }
        return connectionId;
    }
    removeMember(connectionId) {
        this.members.delete(connectionId);
    }
    getMemberByConnectionId(connectionId) {
        return this.members.get(connectionId);
    }
    getMemberUsernames() {
        return Array.from(this.members.values()).map((m) => m.username);
    }
    get hasHost() {
        return this.hostId !== null;
    }
    // ─── Prompt Queue ────────────────────────────────────────────────────────────
    submitPrompt(connectionId, prompt) {
        const member = this.members.get(connectionId);
        if (!member) {
            throw new Error(`Unknown connection: ${connectionId}`);
        }
        const entry = {
            promptId: prompt.promptId,
            connectionId,
            username: member.username,
            content: prompt.content,
            scope: prompt.scope,
            queuedAt: Date.now(),
        };
        this.promptQueue.push(entry);
        return entry;
    }
    getNextPrompt() {
        return this.promptQueue[0] ?? null;
    }
    removePrompt(promptId) {
        const idx = this.promptQueue.findIndex((p) => p.promptId === promptId);
        if (idx !== -1)
            this.promptQueue.splice(idx, 1);
    }
    // ─── Messaging ───────────────────────────────────────────────────────────────
    broadcast(message, excludeConnectionId) {
        const payload = JSON.stringify(message);
        for (const member of this.members.values()) {
            if (member.connectionId === excludeConnectionId)
                continue;
            if (member.ws.readyState === WebSocket.OPEN) {
                member.ws.send(payload);
            }
        }
    }
    sendTo(connectionId, message) {
        const member = this.members.get(connectionId);
        if (member && member.ws.readyState === WebSocket.OPEN) {
            member.ws.send(JSON.stringify(message));
        }
    }
    isHost(connectionId) {
        return this.hostId === connectionId;
    }
    // ─── Private Helpers ─────────────────────────────────────────────────────────
    _resolveUsername(desired) {
        const existing = new Set(this.getMemberUsernames());
        if (!existing.has(desired))
            return desired;
        let suffix = 2;
        while (existing.has(`${desired}-${suffix}`))
            suffix++;
        return `${desired}-${suffix}`;
    }
}
//# sourceMappingURL=party.js.map