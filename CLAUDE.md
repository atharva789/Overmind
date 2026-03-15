# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mandatory Reading

**Read `AGENTS.md` before any code modification.** It defines binding rules for this repository covering commits, architecture, naming, privacy, testing, and security. AGENTS.md takes priority over user instructions when there is a conflict.

## Commands

```bash
# Build TypeScript to dist/
npm run build

# Development with auto-reload
npm run dev

# Link CLI globally after build
npm link

# Run tests
npm test

# Deploy Modal orchestrator to cloud
npm run overmind-deploy
```

**Running a session:**
```bash
# Host (from the project directory you want to edit)
overmind host --port 4444

# Join
overmind join <CODE> --server <host> --port <port> -u "Name"
```

**Required environment variables:**
```bash
GEMINI_API_KEY=...
OVERMIND_LOCAL=1                    # Use local Gemini execution
OVERMIND_ORCHESTRATOR_URL=...       # Use remote Modal execution (alternative)
DATABASE_URL=...                    # PostgreSQL (optional, for story/embedding features)
```

## Architecture

Overmind is a multiplayer AI coding terminal: multiple developers submit prompts to a shared WebSocket session, and a pipeline evaluates then executes code changes on the host's files.

### Execution Pipeline

```
Members submit prompts
  → Party queue (FIFO, deterministic)
  → Scope extraction (Gemini identifies affected files)
  → Greenlight evaluation (AI safety check)
  → Host approval (host-verdict message)
  → Execution: local agent OR Modal sandbox
  → File sync back to host disk
  → Merge conflict resolution (if needed)
  → Optional PR creation
```

### Execution Backends

| Mode | Config | Engine |
|------|--------|--------|
| Local | `OVERMIND_LOCAL=1` | Gemini tool-calling loop in `src/server/execution/agent.ts` |
| Remote | `OVERMIND_ORCHESTRATOR_URL=...` | Modal Python sandboxes via `modal/orchestrator.py` |

### Layer Separation

- `src/shared/` — Zod protocol schemas and constants. Zero runtime side effects.
- `src/server/` — WebSocket server, party lifecycle, execution, merge. No client logic.
- `src/client/` — TUI (Ink/React), connection management. No server logic.
- `modal/` — Python FastAPI orchestrator + vLLM worker for remote execution.

### Key Files

| File | Purpose |
|------|---------|
| `src/server/index.ts` | WebSocket server, party lifecycle, prompt queue, execution dispatch |
| `src/server/party.ts` | Party class: members, prompt queue, broadcast |
| `src/server/execution/agent.ts` | Local Gemini tool-calling loop (read_file, write_file, list_dir) |
| `src/server/execution/scope.ts` | Gemini scope extraction — identifies files affected by a prompt |
| `src/server/orchestrator/index.ts` | Remote execution coordinator; polls Modal, manages file locks |
| `src/server/orchestrator/file-sync.ts` | Pack/unpack workspace for Modal sandboxes |
| `src/server/merge/index.ts` | Conflict detection, AI resolution, commit, PR creation |
| `src/server/story/agent.ts` | Clusters prompts into features, maintains STORY.md |
| `src/shared/protocol.ts` | All WebSocket message types as Zod discriminated unions |
| `src/shared/constants.ts` | Ports, timeouts, env helpers |
| `src/cli.ts` | CLI entry point (commander); also mounts Ink TUI |
| `src/client/ui/App.tsx` | Client state owner (`useReducer`), message router |
| `modal/orchestrator.py` | FastAPI service: run creation, worker spawn, polling |

### Privacy Invariant

Prompt content is visible **only** to the submitter and the host. It must never be broadcast to other members. This is enforced server-side and is a critical invariant.

### Protocol

All WebSocket messages use Zod-validated discriminated unions defined in `src/shared/protocol.ts`. Invalid messages are logged and dropped — never propagated.

### Database (optional)

PostgreSQL + pgvector via `src/server/db.ts`. Tables: `features`, `queries`, `code_chunks`. Used for story clustering and semantic code search. The server runs without a database if `DATABASE_URL` is unset.
