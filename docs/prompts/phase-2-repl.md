# Phase 2: Rich Terminal REPL (Ink UI Layer Only)

Phase 1 (networking, protocol, party system, connection wrapper) is complete
and stable.

Phase 2 replaces all console.log output with a structured Ink-based TUI.

This phase builds:

UI only

No AI logic

No orchestration logic

No diff execution engine

No greenlight agent yet

Server logic must remain deterministic and unchanged except for lightweight
status updates.

## 1. Dependency Additions

Add these runtime dependencies:

ink

ink-text-input

react

chalk

figures

cli-highlight

Do NOT add:

Redux

Zustand

Any state library

Any layout framework besides Ink

Any diff parsing library

Keep dependency count minimal.

## 2. High-Level Layout Contract

The TUI must render this vertical layout:

StatusBar

MainContent (PartyPanel + OutputView)

ActivityFeed

PromptInput

Constraints:

Layout must not flicker.

Layout must remain stable on resize.

Layout must not crash if terminal width < 60 columns.

No component may assume fixed width except PartyPanel.

## 3. Component Tree (Strict)

Create:

src/client/ui/
  App.tsx
  StatusBar.tsx
  PartyPanel.tsx
  OutputView.tsx
  ActivityFeed.tsx
  PromptInput.tsx
  components/
    DiffBlock.tsx
    Spinner.tsx
    Badge.tsx

No additional folders.

No cross-import between sibling components except via App.

## 4. App.tsx (Single Source of Truth)

App.tsx owns all state.

It receives:

{
  connection: Connection;
  session: Session;
}

Use:

useReducer for app state

useEffect for subscribing to connection events

No business logic in child components.

AppState Definition

```
type AppState = {
  members: MemberView[];
  outputs: OutputEntry[];
  events: ActivityEvent[];
  connectionStatus: "connected" | "reconnecting" | "disconnected";
  currentPromptId: string | null;
  isHost: boolean;
  partyCode: string;
};
```

All reducer actions must map 1:1 to server messages.

No derived state duplication.

## 5. StatusBar

Displays:

OVERMIND · Party: AXKM · 3 members · ● Live

Rules:

Use ● character, not emoji

Color dot:

Green = connected

Yellow = reconnecting

Red = disconnected

No blinking

Single row only

Bottom border only

Must gracefully truncate if terminal too small.

## 6. PartyPanel

Fixed width: 20 columns minimum.

Rules:

Must not overflow.

Truncate long usernames.

Host prefixed with ★.

Show status under username.

Statuses:

idle (green)

typing (yellow)

queued (blue)

executing (cyan)

reviewing (magenta)

Color via chalk only.

Never show prompt content.

## 7. OutputView

Private to each user.

Only render outputs for:

state.currentPromptId

Never render outputs belonging to other members.

Must support:

queued

greenlit

redlit

approved

denied

diff

complete

error

Scrolling behavior:

Show last N entries if overflow.

Do not use external scroll library.

Use slicing logic.

Do not auto-scroll aggressively.

## 8. ActivityFeed

Shows last 5 events only.

Format:

HH:MM  username event description

Rules:

Gray/dim color

No prompt content ever

Truncate lines that overflow

No scrolling

This is informational only.

## 9. PromptInput

Single-line input using ink-text-input.

Rules:

Prefix: > in green

Placeholder dim

Disabled when:

currentPromptId != null

On submit:

Generate promptId via nanoid

Send prompt-submit

Set currentPromptId

Clear input

On typing:

Send status-update: { status: "typing" }

On idle (debounce 1s): send status-update: { status: "idle" }

Typing updates must be lightweight and not spam server.

## 10. Protocol Extension (Minimal)

Add:

Client -> Server

status-update

{ status: "typing" | "idle" }

Server -> Client

member-status

{ username: string, status: string }

Server must broadcast status changes.

Status updates must not affect prompt queue.

## 11. Mock Greenlight Behavior (Temporary)

Since Phase 3 adds AI:

For now, server must:

When receiving prompt-submit:

Immediately enqueue

Send prompt-queued

After 2 seconds:

Send prompt-greenlit with mock reasoning

Send activity event

This is deterministic mock logic.

Do NOT add random behavior.

## 12. DiffBlock

For Phase 2:

Accept static mock diff string

Render colored lines:

green

red

others white

Filename header in box

No collapsing behavior yet.

## 13. CLI Integration

Modify cli.ts:

If process.stdout.isTTY:

Render <App /> using Ink

Else:

Fallback to console logging mode (Phase 1 behavior)

Headless mode must remain functional.

## 14. Resize Safety

Requirements:

No component should assume infinite width.

Use useStdout() for width.

PartyPanel must shrink to 16 if width small.

OutputView takes remaining space.

No hard-coded terminal sizes.

Must not crash when:

Width < 50

Height < 15

Graceful degradation required.

## 15. Forbidden in Phase 2

Do NOT:

Add orchestration logic

Add AI logic

Add persistent storage

Add external state library

Add keybindings for navigation

Add diff collapsing

Add animations besides spinner

Add complex scroll management

Add performance optimizations prematurely

Build only what is described.

## 16. Verification Checklist

Implementation complete only if:

npm run build passes

overmind host shows full UI layout

overmind join <code> updates PartyPanel live

Typing shows "typing" status remotely

Submitting shows:

queued

greenlit after 2 seconds

ActivityFeed updates

Terminal resize does not crash

Non-TTY mode still logs via console

## 17. Architectural Goal

Phase 2 is a UI shell around Phase 1.

It must:

Not break networking

Not mutate server state incorrectly

Not leak private data

Not introduce nondeterminism

It prepares the system for Phase 3 (Greenlight Agent integration).
