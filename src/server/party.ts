import { WebSocket } from "ws";
import { customAlphabet } from "nanoid";
import { PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH } from "../shared/constants.js";
import type { ServerMessage } from "../shared/protocol.js";

const generatePartyCode = customAlphabet(PARTY_CODE_ALPHABET, PARTY_CODE_LENGTH);

export interface Member {
  connectionId: string;
  username: string;
  ws: WebSocket;
}

export interface PromptEntry {
  promptId: string;
  connectionId: string;
  username: string;
  content: string;
  scope?: string[];
  queuedAt: number;
}

export class Party {
  readonly code: string;
  hostId: string | null = null;
  readonly members: Map<string, Member> = new Map(); // connectionId → Member
  readonly promptQueue: PromptEntry[] = [];

  constructor(code?: string) {
    this.code = code ?? generatePartyCode();
  }

  // ─── Member Management ───────────────────────────────────────────────────────

  /** Add a member. The first member added becomes the host. Returns connectionId. */
  addMember(ws: WebSocket, username: string, connectionId: string): string {
    const resolvedUsername = this._resolveUsername(username);
    this.members.set(connectionId, { connectionId, username: resolvedUsername, ws });
    if (this.hostId === null) {
      this.hostId = connectionId;
    }
    return connectionId;
  }

  removeMember(connectionId: string): void {
    this.members.delete(connectionId);
  }

  getMemberByConnectionId(connectionId: string): Member | undefined {
    return this.members.get(connectionId);
  }

  getMemberUsernames(): string[] {
    return Array.from(this.members.values()).map((m) => m.username);
  }

  get hasHost(): boolean {
    return this.hostId !== null;
  }

  // ─── Prompt Queue ────────────────────────────────────────────────────────────

  submitPrompt(
    connectionId: string,
    prompt: { promptId: string; content: string; scope?: string[] }
  ): PromptEntry {
    const member = this.members.get(connectionId);
    if (!member) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }
    const entry: PromptEntry = {
      promptId: prompt.promptId,
      connectionId,
      username: member.username,
      content: prompt.content,
      scope: prompt.scope,
      queuedAt: Date.now(),
    };
    this.promptQueue.push(entry);
    return entry;
  }

  getNextPrompt(): PromptEntry | null {
    return this.promptQueue[0] ?? null;
  }

  removePrompt(promptId: string): void {
    const idx = this.promptQueue.findIndex((p) => p.promptId === promptId);
    if (idx !== -1) this.promptQueue.splice(idx, 1);
  }

  // ─── Messaging ───────────────────────────────────────────────────────────────

  broadcast(message: ServerMessage, excludeConnectionId?: string): void {
    const payload = JSON.stringify(message);
    for (const member of this.members.values()) {
      if (member.connectionId === excludeConnectionId) continue;
      if (member.ws.readyState === WebSocket.OPEN) {
        member.ws.send(payload);
      }
    }
  }

  sendTo(connectionId: string, message: ServerMessage): void {
    const member = this.members.get(connectionId);
    if (member && member.ws.readyState === WebSocket.OPEN) {
      member.ws.send(JSON.stringify(message));
    }
  }

  isHost(connectionId: string): boolean {
    return this.hostId === connectionId;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private _resolveUsername(desired: string): string {
    const existing = new Set(this.getMemberUsernames());
    if (!existing.has(desired)) return desired;
    let suffix = 2;
    while (existing.has(`${desired}-${suffix}`)) suffix++;
    return `${desired}-${suffix}`;
  }
}
