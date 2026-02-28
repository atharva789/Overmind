import { WebSocket } from "ws";
import { parseServerMessage } from "../shared/protocol.js";
import { MAX_RECONNECT_DELAY_MS, RECONNECT_DELAYS_MS } from "../shared/constants.js";
export class Connection {
    url;
    ws = null;
    _stopped = false;
    _reconnectAttempt = 0;
    _reconnectTimer = null;
    _listeners = new Map([
        ["connected", new Set()],
        ["disconnected", new Set()],
        ["reconnecting", new Set()],
        ["message", new Set()],
    ]);
    constructor(url) {
        this.url = url;
    }
    on(event, handler) {
        this._listeners.get(event).add(handler);
        return this;
    }
    off(event, handler) {
        this._listeners.get(event).delete(handler);
        return this;
    }
    connect() {
        if (this._stopped)
            return;
        this._open();
    }
    disconnect() {
        this._stopped = true;
        if (this._reconnectTimer !== null) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }
    get isConnected() {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    _open() {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.on("open", () => {
            this._reconnectAttempt = 0;
            this._emit("connected");
        });
        ws.on("message", (data) => {
            const msg = parseServerMessage(data.toString());
            if (msg) {
                this._emit("message", msg);
            }
            // Invalid messages are silently dropped — never throw
        });
        ws.on("close", () => {
            if (this._stopped) {
                this._emit("disconnected");
                return;
            }
            this._scheduleReconnect();
        });
        ws.on("error", () => {
            // Error will be followed by close — handle in close handler
        });
    }
    _scheduleReconnect() {
        if (this._stopped)
            return;
        this._reconnectAttempt++;
        const delays = [...RECONNECT_DELAYS_MS];
        const delay = Math.min(delays[Math.min(this._reconnectAttempt - 1, delays.length - 1)] ?? MAX_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS);
        this._emit("reconnecting", this._reconnectAttempt);
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._open();
        }, delay);
    }
    _emit(event, ...args) {
        for (const handler of this._listeners.get(event) ?? []) {
            handler(...args);
        }
    }
}
//# sourceMappingURL=connection.js.map