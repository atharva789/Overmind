# Overmind — Project Context

Overmind is a multiplayer terminal coding REPL. Multiple developers connect to a shared party, submit prompts, and coordinate code changes through a structured evaluation and execution pipeline.

## Architecture

- **Server**: WebSocket server managing parties, prompt queues, evaluation, and execution simulation
- **Client**: Ink-based TUI with connection management and session handling
- **Greenlight Agent**: Dual-backend prompt evaluator (GLM Modal primary, Gemini fallback)

## Directory Layout

```
src/
  cli.ts              → CLI entry (host/join commands, TTY detection, Ink rendering)
  shared/
    constants.ts      → All constants (ports, timeouts, limits)
    protocol.ts       → Zod-validated client↔server message schemas
  server/
    index.ts          → WebSocket server, party management, eval/exec queues
    party.ts          → Party state (members, prompt queue)
    greenlight/
      agent.ts        → Backend selection, fallback chain, logging
      evaluate.ts     → EvaluationResult contract (Zod), GlmEvalRequest type
      conflict.ts     → Local scope overlap detection
      tools.ts        → read_context + fetch_code tools (Gemini only)
      backends/
        gemini.ts     → Gemini tool-calling loop
        glm_modal.ts  → HTTP POST to Modal GLM
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
- Only the host receives `host-review-request` (with prompt content) for redlit prompts
- Activity events contain only usernames and status labels — never prompt text
- `greenlight.log` records prompt length and scope, never prompt content

## Communication Protocol

Client → Server: `join`, `prompt-submit`, `host-verdict`, `status-update`
Server → Client: `join-ack`, `member-joined`, `member-left`, `prompt-queued`, `prompt-greenlit`, `prompt-redlit`, `prompt-approved`, `prompt-denied`, `host-review-request`, `execution-queued`, `execution-update`, `execution-complete`, `system-status`, `activity`, `error`, `member-status`

## Greenlight Agent

- **Primary**: GLM 5.0 via Modal Sandbox (pre-computed context bundle, no tool calls)
- **Fallback**: Gemini 2.0 Flash via `@google/generative-ai` (tool-calling loop with `read_context`/`fetch_code`)
- **Last resort**: Auto-greenlit with "agent unavailable" reasoning
- Decision policy: greenlit if in doubt; redlit only for architectural violations or clear conflicts

## Execution (Phase 4 Simulation)

When a prompt is greenlit or host-approved, server emits staged execution events:
1. `execution-queued` → 2. Six `execution-update` stages → 3. `execution-complete` with mock diffs

Phase 5 will replace simulation with real sandbox execution.
