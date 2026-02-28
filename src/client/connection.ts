import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { parseServerMessage } from "../shared/protocol.js";
import type { ServerMessage } from "../shared/protocol.js";
import {
    RECONNECT_INITIAL_MS,
    RECONNECT_MAX_MS,
} from "../shared/constants.js";

export interface ConnectionOptions {
    url: string;
    autoReconnect?: boolean;
}

export class Connection extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string;
    private autoReconnect: boolean;
    private manualDisconnect = false;
    private reconnectDelay: number = RECONNECT_INITIAL_MS;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(options: ConnectionOptions) {
        super();
        this.url = options.url;
        this.autoReconnect = options.autoReconnect ?? true;
    }

    connect(): void {
        this.manualDisconnect = false;
        this.doConnect();
    }

    private doConnect(): void {
        this.ws = new WebSocket(this.url);

        this.ws.on("open", () => {
            this.reconnectDelay = RECONNECT_INITIAL_MS;
            this.emit("connected");
        });

        this.ws.on("message", (raw: Buffer | string) => {
            const data = typeof raw === "string" ? raw : raw.toString("utf-8");
            const msg = parseServerMessage(data);
            if (msg) {
                this.emit("message", msg);
            }
            // Silently ignore invalid messages (never throw)
        });

        this.ws.on("close", () => {
            this.emit("disconnected");
            if (!this.manualDisconnect && this.autoReconnect) {
                this.scheduleReconnect();
            }
        });

        this.ws.on("error", () => {
            // Error will be followed by close event
        });
    }

    private scheduleReconnect(): void {
        this.emit("reconnecting", this.reconnectDelay);
        this.reconnectTimer = setTimeout(() => {
            this.doConnect();
        }, this.reconnectDelay);

        // Exponential backoff: 1s → 2s → 4s → 8s → 10s (capped)
        this.reconnectDelay = Math.min(
            this.reconnectDelay * 2,
            RECONNECT_MAX_MS
        );
    }

    send(data: object): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    disconnect(): void {
        this.manualDisconnect = true;
        this.clearReconnectTimer();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /** Stop reconnecting without closing the current socket */
    stopReconnecting(): void {
        this.manualDisconnect = true;
        this.clearReconnectTimer();
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /** Type-safe listener for ServerMessage events */
    onMessage(handler: (msg: ServerMessage) => void): void {
        this.on("message", handler);
    }
}
