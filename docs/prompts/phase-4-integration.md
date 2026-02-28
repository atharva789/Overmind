# Phase 4: Integration and End-to-End Polish

Phase 1 (networking), Phase 2 (Ink TUI), Phase 3 (Greenlight Agent with GLM
Modal primary and Gemini fallback) are implemented.

Phase 4 is integration work. You are not adding Phase 5 execution yet, but you
will finalize the execution-facing protocol and UI surfaces so Phase 5 can plug
in later with no UI changes.

Goals:

Smooth host and member experience

Robust error handling

Host review flow for redlit prompts

Execution UI that consumes server messages, with Phase 4 server simulating
those messages

Non-goals:

No real code execution or diffs extracted from actual changes

No Modal orchestrator implementation

No additional dependencies unless required for Ink behavior you already have

## 0. Protocol and Privacy Rules (Hard Constraints)

Prompt content is private.

Only submitter sees their prompt status details in OutputView or ExecutionView.

Only host receives prompt content when redlit (via host-review-request).

Activity feed never shows prompt content.

All new protocol messages must be validated by Zod.

Server must remain authoritative.

## 1. Host Review Mode

New UI Component

Create: src/client/ui/ReviewPanel.tsx

It appears only for host, only when there is a pending review request.

It must show:

submitter username

full prompt content

greenlight reasoning

conflict prompt IDs list

actions: [A]pprove and [D]eny

Interaction rules

Keyboard shortcuts:

a approves immediately

d enters deny mode, show an inline text input for reason

Enter submits deny reason

Escape cancels deny input and returns to approve or deny choice

Review panel must block prompt input while open.

Multiple incoming review requests must queue. Do not drop any.

App State Integration

In App.tsx, add:

```
type ReviewRequest = {
  promptId: string;
  username: string;
  content: string;
  reasoning: string;
  conflicts: string[];
};

type AppState = {
  // existing fields...
  reviewQueue: ReviewRequest[];
  denyReasonDraft: string | null;
};
```

Reducer rules:

On host-review-request, push onto reviewQueue.

ReviewPanel renders when reviewQueue.length > 0.

On verdict send host-verdict:

approve: { promptId, verdict: "approve" }

deny: { promptId, verdict: "deny", reason }

After sending, shift queue and reset denyReasonDraft.

Server behavior needed:

When host-verdict arrives:

If approve, treat as greenlit for that prompt and proceed to execution
simulation.

If deny, notify submitter with prompt-denied and broadcast activity.

## 2. Execution Feedback UI (Phase 5 Protocol Finalization)

This phase creates the execution UI and protocol messages. The server will
emit simulated execution events so the UI can be tested end-to-end.

New UI Component

Create: src/client/ui/ExecutionView.tsx

This view is for the submitter only, and is driven entirely by server messages.

Stages (Pinned Names, Do Not Change)

The UI must render these exact stage strings when they appear:

Acquiring file locks...

Syncing project files to sandbox...

Spawning sandbox...

Agent is working...

Extracting changes...

Applying changes to codebase...

Then:

render diffs using DiffBlock

show completion summary

Protocol Additions

In src/shared/protocol.ts, add server-to-client messages:

execution-queued:

{ promptId: string, reason: string }

execution-update:

{ promptId: string, stage: string, detail?: string }

execution-complete:

{ promptId: string, files: FileChange[], summary: string }

And define shared type:

```
type FileChange = {
  path: string;
  diff: string;          // unified diff format
  linesAdded: number;
  linesRemoved: number;
};
```

Rules:

Zod schemas must validate:

stage is a string, but UI should only special-case the known stage strings

files array non-empty when execution-complete emitted in simulation

Clients must ignore execution messages for prompts that are not theirs.

App Integration

OutputView may still show queued, greenlit, redlit, approved, denied.

After greenlit or approved, switch the submitter’s main content to
ExecutionView for that prompt until execution-complete.

Keep it simple:

A single “active prompt” view, not a full history browser.

## 3. Server-Side Execution Simulation (Phase 4 Only)

Until Phase 5 exists, simulate execution when a prompt becomes eligible to
run.

Eligibility:

greenlit prompt

or host approved prompt

Simulation rules:

Only simulate for the submitter client.

Broadcast activity events without prompt content.

Timing is deterministic, use fixed delays.

Emit sequence to submitter:

execution-queued with reason Waiting for sandbox slot... for 300ms

execution-update stage 1 for 300ms

stage 2 for 1000ms

stage 3 for 1000ms

stage 4 for 2000ms

stage 5 for 500ms

stage 6 for 500ms

execution-complete with:

one or two mock FileChange entries

summary like Applied 2 files (+23/-4).

Important:

The simulation must not block the party evaluator loop.

Use a per-party sequential execution queue, max 1 executing prompt at a time.

If a second prompt becomes eligible while one is executing, send
execution-queued updates until it starts.

This sets up Phase 5 behavior cleanly.

## 4. Error Handling and Edge Cases

Implement robust handling for:

Connection loss

Client:

StatusBar shows:

reconnecting state

disconnected state if reconnect exceeds 30s

Outgoing messages must queue while reconnecting, then flush on reconnect.

If disconnected for 30s:

show a message in OutputView: Disconnected. Press q to exit.

pressing q exits cleanly

Server:

Must tolerate reconnecting clients cleanly, no crashes on send failures.

Host disconnect

Server must send error with code HOST_DISCONNECTED to remaining members, then
close sockets.

Client:

Show message: Host left, party ended. Press any key to exit.

Exit after keypress.

Greenlight unavailable indicator

Client StatusBar:

If server signals greenlight backend unavailable, show warning text.
Add a server-to-client message:

system-status:

{ greenlightAvailable: boolean, executionBackendAvailable: boolean }

If you already have an equivalent mechanism, use it instead, but do not
invent multiple.

Execution backend offline indicator

If execution backend is down, StatusBar shows warning.

In Phase 4 simulation this should remain “available”, but wire the indicator
so Phase 5 can toggle it.

Invalid party code

Join shows: Party not found. Check the code and try again.

Party full

Add MAX_MEMBERS default 8.

Host can override via CLI --max-members.

Reject join with error code PARTY_FULL.

Client shows clear message and exits.

Empty prompt

Client does not send empty or whitespace-only prompt.

Show inline error in PromptInput area, do not crash.

Rapid submit

Client must not submit if currentPromptId != null.

It should show Waiting for current prompt...

## 5. Activity Feed Enrichment

Expand ActivityFeed event descriptions. Still no prompt content.

Examples:

alice submitted a prompt

bob's prompt was greenlit ✓

bob's prompt was redlit, awaiting host review ⚠

host approved bob's prompt ✓

host denied bob's prompt ✗

bob's changes were applied (3 files, +42/-7)

charlie disconnected

⚠ Greenlight agent temporarily unavailable

Implementation rule:

ActivityFeed consumes activity events only.

Do not add a separate event channel unless necessary.

If needed, extend activity payload to include a structured kind field, but
only if your current model makes formatting impossible.

## 6. Graceful Shutdown

Server:

Handle SIGINT:

Broadcast party end to all members

Wait 1s to flush messages

Close all sockets

Exit

Client:

Handle Ctrl+C:

Close connection

Exit

No hanging processes.

## 7. CLI Polish

Update src/cli.ts commands:

overmind host [--port 4444] [--username <name>] [--max-members 8]

overmind join <code> [--server localhost:4444] [--username <name>]

overmind --version

overmind --help

Host startup prints:

Party started! Code: AXKM (share this with your team)

Then show a banner for 2 seconds before rendering the TUI:

╔═══════════════════════════════════╗
║         O V E R M I N D          ║
║   Multiplayer Coding Terminal    ║
╠═══════════════════════════════════╣
║  Party: AXKM  ·  Members: 1/8    ║
║  Share this code with your team  ║
╚═══════════════════════════════════╝

Banner must not break non-TTY mode. If non-TTY, skip banner and use console
mode.

## 8. Root context.md

Create context.md at project root using the provided template, but update it
to reflect:

Greenlight dual backend (GLM Modal primary, Gemini fallback)

Phase 4 simulated execution messages

Privacy constraints

Do not create additional context.md files in Phase 4.

## 9. End-to-End Verification Script

Phase 4 is complete only if this scenario works:

GEMINI_API_KEY=<key> overmind host --username alice

banner shows then TUI

overmind join <code> --username bob

PartyPanel updates in both

Bob submits a reasonable prompt

greenlit

ExecutionView shows staged progress then mock diff then complete

ActivityFeed shows applied summary

Alice and Bob submit prompts with overlapping scope

one is redlit

host sees ReviewPanel

host approves

approved prompt proceeds to execution simulation

Bob submits absurd prompt

redlit

host denies with reason

bob sees prompt-denied

Kill bob terminal

alice sees disconnect event

Ctrl+C on host

members receive party ended error and exit after keypress

npm run build passes

Strict Phase Boundary

Do not:

implement real Modal orchestration

apply real diffs to the repo

run builds or tests automatically

add new dependencies beyond Phase 4 needs

Phase 4 is integration, polish, and simulated execution messaging only.
