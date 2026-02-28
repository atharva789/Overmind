import { WebSocketServer, WebSocket } from "ws";
import { nanoid } from "nanoid";
import { Party } from "./party.js";
import { parseClientMessage } from "../shared/protocol.js";
import { ERROR_CODES, DEFAULT_PORT, JOIN_TIMEOUT_MS } from "../shared/constants.js";
import type { ServerMessage } from "../shared/protocol.js";

function log(msg: string, partyCode?: string): void {
  const ts = new Date().toISOString();
  const prefix = partyCode ? `[${ts}] [${partyCode}]` : `[${ts}]`;
  console.log(`${prefix} ${msg}`);
}

function errorMsg(message: string, code: string): ServerMessage {
  return { type: "error", payload: { message, code } };
}

export interface OvermindServer {
  /** Reserve a party code before any WebSocket connects. Returns the party code. */
  reserveParty(): string;
  wss: WebSocketServer;
}

export function startOvermindServer(port: number = DEFAULT_PORT): OvermindServer {
  const parties = new Map<string, Party>();
  const connToParty = new Map<string, string>(); // connectionId → partyCode

  const wss = new WebSocketServer({ port });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[overmind] Port ${port} is already in use. Is another server running?`);
      process.exit(1);
    }
    log(`Server error: ${err.message}`);
  });

  log(`Overmind server listening on port ${port}`);

  // ─── Per-connection setup ───────────────────────────────────────────────────

  function wireAuthenticatedHandlers(ws: WebSocket, connectionId: string): void {
    ws.on("message", (data: Buffer | string) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        log(`Invalid message from ${connectionId}`);
        ws.send(JSON.stringify(errorMsg("Invalid message", ERROR_CODES.INVALID_MESSAGE)));
        return;
      }
      handleAuthedMessage(ws, connectionId, msg);
    });

    ws.on("close", () => handleDisconnect(connectionId));
    ws.on("error", (err) => log(`Socket error [${connectionId}]: ${err.message}`));
  }

  function handleAuthedMessage(
    ws: WebSocket,
    connectionId: string,
    msg: NonNullable<ReturnType<typeof parseClientMessage>>
  ): void {
    if (msg.type === "join") return; // already joined, ignore

    const partyCode = connToParty.get(connectionId);
    if (!partyCode) return;
    const party = parties.get(partyCode);
    if (!party) return;

    if (msg.type === "prompt-submit") {
      const { promptId, content, scope } = msg.payload;
      const entry = party.submitPrompt(connectionId, { promptId, content, scope });
      const position = party.promptQueue.indexOf(entry) + 1;

      party.sendTo(connectionId, { type: "prompt-queued", payload: { promptId, position } });

      if (!party.isHost(connectionId)) {
        const member = party.getMemberByConnectionId(connectionId)!;
        // Privacy: full content goes only to host
        if (party.hostId) {
          party.sendTo(party.hostId, {
            type: "host-review-request",
            payload: {
              promptId,
              username: member.username,
              content,
              reasoning: "",
              conflicts: [],
            },
          });
        }
        // Non-host members only get activity (no content)
        party.broadcast(
          {
            type: "activity",
            payload: {
              username: member.username,
              event: "submitted-prompt",
              timestamp: Date.now(),
            },
          },
          party.hostId ?? undefined
        );
      }
      log(`Prompt ${promptId} queued at position ${position}`, partyCode);
      return;
    }

    if (msg.type === "host-verdict") {
      if (!party.isHost(connectionId)) {
        ws.send(JSON.stringify(errorMsg("Only host can issue verdicts", ERROR_CODES.INVALID_MESSAGE)));
        return;
      }
      const { promptId, verdict, reason } = msg.payload;
      if (verdict === "approve") {
        party.broadcast({ type: "prompt-approved", payload: { promptId } });
        log(`Host approved prompt ${promptId}`, partyCode);
      } else {
        party.broadcast({
          type: "prompt-denied",
          payload: { promptId, reason: reason ?? "Denied by host" },
        });
        log(`Host denied prompt ${promptId}`, partyCode);
      }
      party.removePrompt(promptId);
    }
  }

  function handleDisconnect(connectionId: string): void {
    const partyCode = connToParty.get(connectionId);
    if (!partyCode) return;
    const party = parties.get(partyCode);
    if (!party) return;

    const member = party.getMemberByConnectionId(connectionId);
    const username = member?.username ?? "unknown";
    const wasHost = party.isHost(connectionId);

    party.removeMember(connectionId);
    connToParty.delete(connectionId);
    log(`${username} disconnected`, partyCode);

    if (wasHost) {
      log(`Host disconnected — ending party`, partyCode);
      party.broadcast(errorMsg("Party ended: host disconnected", ERROR_CODES.PARTY_ENDED));
      for (const m of party.members.values()) m.ws.close();
      parties.delete(partyCode);
    } else {
      party.broadcast({ type: "member-left", payload: { username } });
      party.broadcast({
        type: "activity",
        payload: { username, event: "left", timestamp: Date.now() },
      });
    }
  }

  // ─── Incoming connections ───────────────────────────────────────────────────

  wss.on("connection", (ws) => {
    const tempId = nanoid(12);
    let joined = false;

    const joinTimer = setTimeout(() => {
      if (!joined) {
        log(`Connection ${tempId} timed out waiting for join`);
        ws.send(JSON.stringify(errorMsg("Join timeout", ERROR_CODES.JOIN_TIMEOUT)));
        ws.close();
      }
    }, JOIN_TIMEOUT_MS);

    // One-shot join handler
    ws.once("message", (data: Buffer | string) => {
      clearTimeout(joinTimer);
      const msg = parseClientMessage(data.toString());

      if (!msg || msg.type !== "join") {
        ws.send(JSON.stringify(errorMsg("Invalid message", ERROR_CODES.INVALID_MESSAGE)));
        ws.close();
        return;
      }

      const { partyCode, username } = msg.payload;
      const party = parties.get(partyCode.toUpperCase());

      if (!party) {
        log(`Party not found: ${partyCode}`);
        ws.send(JSON.stringify(errorMsg("Party not found", ERROR_CODES.PARTY_NOT_FOUND)));
        ws.close();
        return;
      }

      joined = true;
      const connectionId = nanoid(12);
      const isHost = !party.hasHost; // first joiner becomes host
      party.addMember(ws, username, connectionId);
      connToParty.set(connectionId, party.code);

      const resolvedUsername = party.getMemberByConnectionId(connectionId)!.username;

      party.sendTo(connectionId, {
        type: "join-ack",
        payload: {
          partyCode: party.code,
          members: party.getMemberUsernames(),
          isHost,
        },
      });

      if (!isHost) {
        party.broadcast(
          { type: "member-joined", payload: { username: resolvedUsername } },
          connectionId
        );
        party.broadcast({
          type: "activity",
          payload: { username: resolvedUsername, event: "joined", timestamp: Date.now() },
        });
      }

      log(`${resolvedUsername} joined${isHost ? " as host" : ""}`, party.code);
      wireAuthenticatedHandlers(ws, connectionId);
    });

    ws.on("close", () => {
      if (!joined) {
        clearTimeout(joinTimer);
        log(`Connection ${tempId} closed before joining`);
      }
    });

    ws.on("error", (err) => log(`Pre-join error [${tempId}]: ${err.message}`));
  });

  // ─── Party reservation ──────────────────────────────────────────────────────

  function reserveParty(): string {
    const party = new Party();
    parties.set(party.code, party);
    log(`Party reserved: ${party.code}`);
    return party.code;
  }

  return { wss, reserveParty };
}
