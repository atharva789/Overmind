// Purpose: Maintain party state for connected members and prompts.
// Behavior: Tracks host, members, and prompt queue with deterministic IDs.
// Assumptions: Each party has a single host and unique usernames.
// Invariants: Member connection IDs and usernames remain unique per party.

import { WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import type { ServerMessage } from "../shared/protocol.js";
import {
    PARTY_CODE_LENGTH,
    PARTY_CODE_ALPHABET,
} from "../shared/constants.js";

const generatePartyCode = customAlphabet(PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH);

// ─── Types ───

export interface Member {
    connectionId: string;
    username: string;
    ws: WebSocket;
}

export interface PromptEntry {
    promptId: string;
    connectionId: string;
    username: string;
    content: string;
    scope?: string[];
    position: number;
}

// ─── Party ───

export class Party {
    code: string;
    hostId: string;
    repository: string;
    members: Map<string, Member> = new Map();
    promptQueue: PromptEntry[] = [];

    private usernameSet: Set<string> = new Set();
    private promptCounter = 0;

    constructor(
        connectionId: string,
        hostWs: WebSocket,
        hostUsername: string,
        repository: string
    ) {
        this.code = generatePartyCode();
        const resolvedUsername = this.resolveUsername(hostUsername);
        this.hostId = connectionId;
        this.repository = repository;

        this.members.set(connectionId, {
            connectionId,
            username: resolvedUsername,
            ws: hostWs,
        });
        this.usernameSet.add(resolvedUsername);
    }

    /** Resolve username conflicts: name → name-2 → name-3 ... */
    private resolveUsername(desired: string): string {
        if (!this.usernameSet.has(desired)) {
            return desired;
        }
        let suffix = 2;
        while (this.usernameSet.has(`${desired}-${suffix}`)) {
            suffix++;
        }
        return `${desired}-${suffix}`;
    }

    addMember(ws: WebSocket, username: string, connectionId: string): string {
        const resolvedUsername = this.resolveUsername(username);
        this.members.set(connectionId, {
            connectionId,
            username: resolvedUsername,
            ws,
        });
        this.usernameSet.add(resolvedUsername);
        return resolvedUsername;
    }

    removeMember(connectionId: string): void {
        const member = this.members.get(connectionId);
        if (member) {
            this.usernameSet.delete(member.username);
            this.members.delete(connectionId);
        }
    }

    submitPrompt(
        connectionId: string,
        prompt: { promptId: string; content: string; scope?: string[] }
    ): PromptEntry {
        const member = this.members.get(connectionId);
        if (!member) {
            throw new Error("Member not found");
        }
        this.promptCounter++;
        const entry: PromptEntry = {
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

    getNextPrompt(): PromptEntry | null {
        return this.promptQueue.shift() ?? null;
    }

    broadcast(message: ServerMessage, excludeConnectionId?: string): void {
        const data = JSON.stringify(message);
        for (const [id, member] of this.members) {
            if (id !== excludeConnectionId && member.ws.readyState === WebSocket.OPEN) {
                member.ws.send(data);
            }
        }
    }

    sendTo(connectionId: string, message: ServerMessage): void {
        const member = this.members.get(connectionId);
        if (member && member.ws.readyState === WebSocket.OPEN) {
            member.ws.send(JSON.stringify(message));
        }
    }

    isHost(connectionId: string): boolean {
        return this.hostId === connectionId;
    }

    getMemberUsernames(): string[] {
        return [...this.members.values()].map((m) => m.username);
    }

    getMemberByConnectionId(connectionId: string): Member | undefined {
        return this.members.get(connectionId);
    }
}
