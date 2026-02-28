import { WebSocket } from "ws";
import type { ServerMessage } from "../shared/protocol.js";
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
export declare class Party {
    code: string;
    hostId: string;
    projectRoot: string;
    members: Map<string, Member>;
    promptQueue: PromptEntry[];
    private usernameSet;
    private promptCounter;
    constructor(connectionId: string, hostWs: WebSocket, hostUsername: string, projectRoot?: string);
    /** Resolve username conflicts: name → name-2 → name-3 ... */
    private resolveUsername;
    addMember(ws: WebSocket, username: string, connectionId: string): string;
    removeMember(connectionId: string): void;
    submitPrompt(connectionId: string, prompt: {
        promptId: string;
        content: string;
        scope?: string[];
    }): PromptEntry;
    getNextPrompt(): PromptEntry | null;
    broadcast(message: ServerMessage, excludeConnectionId?: string): void;
    sendTo(connectionId: string, message: ServerMessage): void;
    isHost(connectionId: string): boolean;
    getMemberUsernames(): string[];
    getMemberByConnectionId(connectionId: string): Member | undefined;
}
