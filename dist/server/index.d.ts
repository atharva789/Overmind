import { WebSocketServer } from "ws";
export declare function setMaxMembers(n: number): void;
export declare function reserveParty(hostUsername: string): string;
export declare function startServer(): WebSocketServer;
/**
 * Gracefully shut down all parties: send PARTY_ENDED to all members,
 * then close all sockets. Call this before wss.close().
 */
export declare function shutdownAllParties(): void;
