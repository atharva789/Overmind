import { Connection } from "./connection.js";
export interface SessionOptions {
    host?: string;
    port?: number;
    partyCode: string;
    username: string;
    /** If true, skip console.log handlers (UI mode handles display) */
    silent?: boolean;
}
export declare class Session {
    readonly connection: Connection;
    private partyCode;
    readonly username: string;
    private silent;
    constructor(options: SessionOptions);
    private setupHandlers;
    private handleServerMessage;
    connect(): void;
    disconnect(): void;
    submitPrompt(promptId: string, content: string, scope?: string[]): void;
    sendVerdict(promptId: string, verdict: "approve" | "deny", reason?: string): void;
    sendStatusUpdate(status: "typing" | "idle"): void;
}
