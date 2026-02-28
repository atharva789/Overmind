import { WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import { PARTY_CODE_LENGTH, PARTY_CODE_ALPHABET, } from "../shared/constants.js";
const generatePartyCode = customAlphabet(PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH);
// ─── Party ───
export class Party {
    code;
    hostId;
    members = new Map();
    promptQueue = [];
    usernameSet = new Set();
    promptCounter = 0;
    constructor(connectionId, hostWs, hostUsername) {
        this.code = generatePartyCode();
        const resolvedUsername = this.resolveUsername(hostUsername);
        this.hostId = connectionId;
        this.members.set(connectionId, {
            connectionId,
            username: resolvedUsername,
            ws: hostWs,
        });
        this.usernameSet.add(resolvedUsername);
    }
    /** Resolve username conflicts: name → name-2 → name-3 ... */
    resolveUsername(desired) {
        if (!this.usernameSet.has(desired)) {
            return desired;
        }
        let suffix = 2;
        while (this.usernameSet.has(`${desired}-${suffix}`)) {
            suffix++;
        }
        return `${desired}-${suffix}`;
    }
    addMember(ws, username, connectionId) {
        const resolvedUsername = this.resolveUsername(username);
        this.members.set(connectionId, {
            connectionId,
            username: resolvedUsername,
            ws,
        });
        this.usernameSet.add(resolvedUsername);
        return resolvedUsername;
    }
    removeMember(connectionId) {
        const member = this.members.get(connectionId);
        if (member) {
            this.usernameSet.delete(member.username);
            this.members.delete(connectionId);
        }
    }
    submitPrompt(connectionId, prompt) {
        const member = this.members.get(connectionId);
        if (!member) {
            throw new Error("Member not found");
        }
        this.promptCounter++;
        const entry = {
            promptId: prompt.promptId,
            connectionId,
            username: member.username,
            content: prompt.content,
            scope: prompt.scope,
            position: this.promptCounter,
        };
        this.promptQueue.push(entry);
        return entry;
    }
    getNextPrompt() {
        return this.promptQueue.shift() ?? null;
    }
    broadcast(message, excludeConnectionId) {
        const data = JSON.stringify(message);
        for (const [id, member] of this.members) {
            if (id !== excludeConnectionId && member.ws.readyState === WebSocket.OPEN) {
                member.ws.send(data);
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
    getMemberUsernames() {
        return [...this.members.values()].map((m) => m.username);
    }
    getMemberByConnectionId(connectionId) {
        return this.members.get(connectionId);
    }
}
//# sourceMappingURL=party.js.map