# Phase 1: Networking & Party System (Foundational Layer Only)

You are building Phase 1 of Overmind, a multiplayer terminal coding REPL.

This phase implements only the networking and party coordination layer.

There is:

No AI logic

No greenlight logic

No UI beyond console logging

No orchestration engine yet

This phase must be minimal, deterministic, and privacy-safe.

## 1. Project Setup

Initialize a TypeScript Node.js project in the current directory.

Requirements

package.json

name: overmind

"type": "module"

"bin" entry pointing overmind to dist/cli.js

Dependencies:

ws

commander

nanoid

zod

Dev dependencies:

typescript

@types/ws

@types/node

tsx

Scripts:

build -> tsc

dev -> tsx --watch src/cli.ts

start -> node dist/cli.js

tsconfig.json

target: ES2022

module: NodeNext

strict: true

rootDir: src

outDir: dist

sourceMap: true

no implicit any

no unused locals

no unused parameters

Use ESM everywhere.

All local imports MUST use .js extensions.

Build must succeed before moving forward.

## 2. Project Structure (Strict)

src/
  cli.ts
  shared/
    protocol.ts
    constants.ts
  server/
    index.ts
    party.ts
  client/
    connection.ts
    session.ts

Rules:

No circular dependencies.

shared/ must contain zero runtime side effects.

server/ must not import from client/.

client/ must not import from server/.

## 3. Message Protocol (Deterministic & Strict)

File: src/shared/protocol.ts

All messages MUST:

Be JSON

Have shape { type: string, payload: object }

Be validated using Zod discriminated unions

Be rejected if invalid

Export:

ClientMessage

ServerMessage

ClientMessageSchema

ServerMessageSchema

parseClientMessage

parseServerMessage

parse* functions must:

Never throw

Return null on invalid input

Client -> Server

join

{ partyCode: string, username: string }

prompt-submit

{ promptId: string, content: string, scope?: string[] }

host-verdict

{ promptId: string, verdict: "approve" | "deny", reason?: string }

Server -> Client

join-ack

{ partyCode: string, members: string[], isHost: boolean }

member-joined

{ username: string }

member-left

{ username: string }

prompt-queued

{ promptId: string, position: number }

prompt-greenlit

{ promptId: string, reasoning: string }

prompt-redlit

{ promptId: string, reasoning: string, conflicts: string[] }

prompt-approved

{ promptId: string }

prompt-denied

{ promptId: string, reason: string }

host-review-request

{ promptId: string, username: string, content: string, reasoning: string, conflicts: string[] }

activity

{ username: string, event: string, timestamp: number }

error

{ message: string, code: string }

Error Codes (Mandatory)

Define constant error codes:

PARTY_NOT_FOUND

JOIN_TIMEOUT

PARTY_ENDED

INVALID_MESSAGE

USERNAME_CONFLICT

Do not invent codes dynamically.

## 4. Party System

File: src/server/party.ts

The Party class manages all state for one party.

Invariants (Must Always Hold)

Exactly one host per party

All usernames unique within party

All connection IDs unique

Prompt queue is FIFO

Prompt content is never broadcast to non-host members

Party Codes

4 characters

Uppercase alphanumeric

Exclude 0, O, I, 1

Alphabet: ABCDEFGHJKLMNPQRSTUVWXYZ23456789

Use nanoid custom alphabet

Required API

class Party {
  code: string
  hostId: string
  members: Map<string, Member>
  promptQueue: PromptEntry[]

  addMember(ws: WebSocket, username: string): string
  removeMember(connectionId: string): void
  submitPrompt(connectionId: string, prompt): PromptEntry
  getNextPrompt(): PromptEntry | null

  broadcast(message: ServerMessage, excludeConnectionId?: string): void
  sendTo(connectionId: string, message: ServerMessage): void
  isHost(connectionId: string): boolean
}

Username conflicts must auto-resolve with suffix:

name, name-2, name-3, etc.

Do not silently overwrite.

## 5. WebSocket Server

File: src/server/index.ts

Behavior

Listen on port 4444 by default

Override via OVERMIND_PORT

Assign connectionId using nanoid(12)

Require join message within 5 seconds

If not received -> disconnect with JOIN_TIMEOUT

Join Flow

If party not found -> send error(PARTY_NOT_FOUND) then close

If found:

Add member

Send join-ack

Broadcast member-joined

Broadcast activity

Disconnect Flow

Remove member

Broadcast member-left

If host disconnects:

Send error(PARTY_ENDED) to all

Close all sockets

Delete party

Logging

All server logs must:

Include timestamp

Include party code when applicable

Never log prompt content

## 6. Client Connection Wrapper

File: src/client/connection.ts

Must:

Validate all incoming messages

Emit events:

connected

disconnected

reconnecting

message

Auto-reconnect:

1s -> 2s -> 4s -> capped at 10s

Stop reconnecting if disconnect() called manually

Never throw on invalid message.

## 7. CLI

File: src/cli.ts

Use commander.

Commands

overmind host

Start server

Create party

Print party code

Connect as host

overmind join <code>

Connect to server

Join party

Username default:

os.userInfo().username

fallback to process.env.USER

For Phase 1:

Log all events to console

No UI framework

No interactive TUI yet

## 8. Privacy Rules (Critical)

Prompt content must never be broadcast

Only host may receive host-review-request

Other members only receive activity

Server enforces privacy, not client

Any privacy leak is a failure.

## 9. Verification Checklist

The implementation is complete only if:

npm run build passes

overmind host prints a party code

overmind join <code> connects successfully

Both terminals show join events

Submitting a prompt logs an activity event on host

Killing join shows "member left"

Killing host ends party and disconnects members

Invalid JSON does not crash server

Invalid messages are logged and ignored

## 10. Strict Constraints

Do NOT:

Add UI framework

Add greenlight logic

Add AI logic

Add orchestration layer

Add additional abstractions

Add unrequested dependencies

Build exactly Phase 1.

Minimal. Deterministic. Clean.
