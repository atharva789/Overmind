import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import { parseServerMessage } from "../shared/protocol.js";
import { RECONNECT_INITIAL_MS, RECONNECT_MAX_MS, } from "../shared/constants.js";
export class Connection extends EventEmitter {
    ws = null;
    url;
    autoReconnect;
    manualDisconnect = false;
    reconnectDelay = RECONNECT_INITIAL_MS;
    reconnectTimer = null;
    constructor(options) {
        super();
        this.url = options.url;
        this.autoReconnect = options.autoReconnect ?? true;
    }
    connect() {
        this.manualDisconnect = false;
        this.doConnect();
    }
    doConnect() {
        this.ws = new WebSocket(this.url);
        this.ws.on("open", () => {
            this.reconnectDelay = RECONNECT_INITIAL_MS;
            this.emit("connected");
        });
        this.ws.on("message", (raw) => {
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
    scheduleReconnect() {
        this.emit("reconnecting", this.reconnectDelay);
        this.reconnectTimer = setTimeout(() => {
            this.doConnect();
        }, this.reconnectDelay);
        // Exponential backoff: 1s → 2s → 4s → 8s → 10s (capped)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    }
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    disconnect() {
        this.manualDisconnect = true;
        this.clearReconnectTimer();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    /** Stop reconnecting without closing the current socket */
    stopReconnecting() {
        this.manualDisconnect = true;
        this.clearReconnectTimer();
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    /** Type-safe listener for ServerMessage events */
    onMessage(handler) {
        this.on("message", handler);
    }
}
//# sourceMappingURL=connection.js.map