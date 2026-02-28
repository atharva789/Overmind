/**
 * Purpose: Auto-reconnecting WebSocket client wrapper with typed events.
 *
 * High-level behavior: Wraps a WebSocket with exponential back-off
 * reconnection (1 → 2 → 4 → 10 s cap). Validates all incoming
 * messages via parseServerMessage and drops invalid ones silently.
 * Emits typed events: connected, disconnected, reconnecting, message.
 *
 * Assumptions:
 *  - The provided URL is a valid ws:// or wss:// address.
 *  - Callers call connect() exactly once after registering handlers.
 *
 * Invariants:
 *  - Once disconnect() is called, no reconnect attempts occur.
 *  - Invalid messages never reach event handlers.
 *  - send() is a no-op when the socket is not open.
 */

import { WebSocket } from "ws";
import { parseServerMessage } from "../shared/protocol.js";
import { MAX_RECONNECT_DELAY_MS, RECONNECT_DELAYS_MS } from "../shared/constants.js";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";

type ConnectionEvent = "connected" | "disconnected" | "reconnecting" | "message";

type EventMap = {
  connected: () => void;
  disconnected: () => void;
  reconnecting: (attempt: number) => void;
  message: (msg: ServerMessage) => void;
};

export class Connection {
  private ws: WebSocket | null = null;
  private _stopped = false;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _listeners: Map<ConnectionEvent, Set<(...args: unknown[]) => void>> = new Map([
    ["connected", new Set()],
    ["disconnected", new Set()],
    ["reconnecting", new Set()],
    ["message", new Set()],
  ]);

  constructor(private readonly url: string) {}

  on<E extends ConnectionEvent>(event: E, handler: EventMap[E]): this {
    this._listeners.get(event)!.add(handler as (...args: unknown[]) => void);
    return this;
  }

  off<E extends ConnectionEvent>(event: E, handler: EventMap[E]): this {
    this._listeners.get(event)!.delete(handler as (...args: unknown[]) => void);
    return this;
  }

  connect(): void {
    if (this._stopped) return;
    this._open();
  }

  disconnect(): void {
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

  send(msg: ClientMessage | object): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private _open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this._reconnectAttempt = 0;
      this._emit("connected");
    });

    ws.on("message", (data: Buffer | string) => {
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

  private _scheduleReconnect(): void {
    if (this._stopped) return;
    this._reconnectAttempt++;
    const delays = [...RECONNECT_DELAYS_MS];
    const delay = Math.min(
      delays[Math.min(this._reconnectAttempt - 1, delays.length - 1)] ?? MAX_RECONNECT_DELAY_MS,
      MAX_RECONNECT_DELAY_MS
    );
    this._emit("reconnecting", this._reconnectAttempt);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._open();
    }, delay);
  }

  private _emit(event: "connected"): void;
  private _emit(event: "disconnected"): void;
  private _emit(event: "reconnecting", attempt: number): void;
  private _emit(event: "message", msg: ServerMessage): void;
  private _emit(event: ConnectionEvent, ...args: unknown[]): void {
    for (const handler of this._listeners.get(event) ?? []) {
      handler(...args);
    }
  }
}
