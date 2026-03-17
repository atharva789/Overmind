/**
 * Purpose: Start and manage the WebSocket server and party lifecycle.
 * High-level behavior: Handles joins, prompt evaluation, and execution.
 * Assumptions: startServer is called by the host CLI process.
 * Invariants: Prompt content is never broadcast to non-host members.
 */
import { WebSocketServer } from "ws";
/**
 * Configure the max members allowed per party.
 * Does not retroactively remove existing members.
 */
export declare function setMaxMembers(n: number): void;
export declare function reserveParty(hostUsername: string): string;
/**
 * Start the WebSocket server and initialize orchestrator health checks.
 * Does not block on health checks; runs asynchronously.
 */
export declare function startServer(): WebSocketServer;
/**
 * Gracefully shut down all parties and bridge processes.
 * Sends PARTY_ENDED before closing sockets and stopping orchestrators.
 */
export declare function shutdownAllParties(): void;
