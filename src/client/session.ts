import { Connection } from "./connection.js";
import type { ServerMessage, ClientMessage } from "../shared/protocol.js";

export interface SessionOptions {
  serverUrl: string;
  username: string;
  partyCode: string;
}

export class Session {
  private readonly conn: Connection;
  readonly username: string;
  readonly partyCode: string;

  constructor(opts: SessionOptions) {
    this.username = opts.username;
    this.partyCode = opts.partyCode;
    this.conn = new Connection(opts.serverUrl);

    this.conn
      .on("connected", () => {
        // Send join immediately on connect/reconnect
        const joinMsg: ClientMessage = {
          type: "join",
          payload: { partyCode: this.partyCode, username: this.username },
        };
        this.conn.send(joinMsg);
      })
      .on("disconnected", () => {
        console.log(`[session] Disconnected from party ${this.partyCode}`);
      })
      .on("reconnecting", (attempt) => {
        console.log(`[session] Reconnecting (attempt ${attempt})...`);
      })
      .on("message", (msg: ServerMessage) => {
        this._handleMessage(msg);
      });
  }

  start(): void {
    this.conn.connect();
  }

  stop(): void {
    this.conn.disconnect();
  }

  sendRaw(msg: ClientMessage): void {
    this.conn.send(msg);
  }

  private _handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "join-ack":
        console.log(
          `[session] Joined party ${msg.payload.partyCode} | Members: ${msg.payload.members.join(", ")} | Host: ${msg.payload.isHost}`
        );
        break;
      case "member-joined":
        console.log(`[session] ${msg.payload.username} joined the party`);
        break;
      case "member-left":
        console.log(`[session] ${msg.payload.username} left the party`);
        break;
      case "activity":
        console.log(
          `[session] Activity — ${msg.payload.username}: ${msg.payload.event}`
        );
        break;
      case "prompt-queued":
        console.log(
          `[session] Prompt ${msg.payload.promptId} queued at position ${msg.payload.position}`
        );
        break;
      case "host-review-request":
        console.log(
          `[session] [HOST] Review request — ${msg.payload.username} submitted prompt ${msg.payload.promptId}`
        );
        break;
      case "prompt-approved":
        console.log(`[session] Prompt ${msg.payload.promptId} approved`);
        break;
      case "prompt-denied":
        console.log(
          `[session] Prompt ${msg.payload.promptId} denied: ${msg.payload.reason}`
        );
        break;
      case "prompt-greenlit":
        console.log(
          `[session] Prompt ${msg.payload.promptId} greenlit: ${msg.payload.reasoning}`
        );
        break;
      case "prompt-redlit":
        console.log(
          `[session] Prompt ${msg.payload.promptId} redlit: ${msg.payload.reasoning}`
        );
        break;
      case "error":
        console.error(`[session] Error [${msg.payload.code}]: ${msg.payload.message}`);
        if (
          msg.payload.code === "PARTY_ENDED" ||
          msg.payload.code === "PARTY_NOT_FOUND" ||
          msg.payload.code === "JOIN_TIMEOUT"
        ) {
          this.stop();
        }
        break;
      default:
        break;
    }
  }
}
