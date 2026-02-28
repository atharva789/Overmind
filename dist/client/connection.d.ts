import { EventEmitter } from "node:events";
import type { ServerMessage } from "../shared/protocol.js";
export interface ConnectionOptions {
    url: string;
    autoReconnect?: boolean;
}
export declare class Connection extends EventEmitter {
    private ws;
    private url;
    private autoReconnect;
    private manualDisconnect;
    private reconnectDelay;
    private reconnectTimer;
    constructor(options: ConnectionOptions);
    connect(): void;
    private doConnect;
    private scheduleReconnect;
    send(data: object): void;
    disconnect(): void;
    /** Stop reconnecting without closing the current socket */
    stopReconnecting(): void;
    private clearReconnectTimer;
    /** Type-safe listener for ServerMessage events */
    onMessage(handler: (msg: ServerMessage) => void): void;
}
