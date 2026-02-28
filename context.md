# Overmind — Project Context

Overmind is a multiplayer terminal coding REPL. Multiple developers connect to
a shared party, submit prompts, and coordinate code changes through a
structured review and execution pipeline.

## Architecture

- **Server**: WebSocket server managing parties, prompt queues, host review,
  and execution simulation
- **Client**: Ink-based TUI with connection management and session handling
- **Repository Guard**: Joins require matching GitHub repository identifiers

## Directory Layout

```
src/
  cli.ts              → CLI entry (host/join commands, TTY detection, Ink rendering)
  shared/
    constants.ts      → All constants (ports, timeouts, limits)
    protocol.ts       → Zod-validated client↔server message schemas
  server/
    index.ts          → WebSocket server, party management, exec queues
    party.ts          → Party state (members, prompt queue)
  client/
    connection.ts     → WebSocket wrapper with reconnect
    session.ts        → Session lifecycle + console fallback
    ui/
      App.tsx         → State owner (useReducer), all message routing
      StatusBar.tsx   → Party info + connection + availability indicators
      PartyPanel.tsx  → Member list with status
      OutputView.tsx  → Prompt lifecycle display
      ActivityFeed.tsx→ Last 5 events (dimmed)
      PromptInput.tsx → Text input with typing/idle debounce
      ReviewPanel.tsx → Host-only review with [A]pprove/[D]eny
      ExecutionView.tsx → Staged execution progress + DiffBlock
      components/
        Spinner.tsx   → Animated braille spinner
        Badge.tsx     → Colored status badge
        DiffBlock.tsx → Unified diff renderer
```

## Privacy Constraints

- Prompt content is NEVER broadcast to non-submitter, non-host members
- Only the host receives `host-review-request` (with prompt content)
- Activity events contain only usernames and status labels — never prompt text

## Communication Protocol

Client → Server: `join`, `prompt-submit`, `host-verdict`, `status-update`
Server → Client: `join-ack`, `member-joined`, `member-left`, `prompt-queued`,
`prompt-approved`, `prompt-denied`, `host-review-request`, `execution-queued`,
`execution-update`, `execution-complete`, `system-status`, `activity`, `error`,
`member-status`

## Execution (Phase 4 Simulation)

When a prompt is host-approved, the server emits staged execution events:
1. `execution-queued` → 2. Six `execution-update` stages → 3. `execution-complete` with mock diffs

Phase 5 will replace simulation with real sandbox execution.
