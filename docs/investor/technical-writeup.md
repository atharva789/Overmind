# Overmind — Technical Writeup

*For hiring managers and technical evaluators at AI/infrastructure engineering companies.*

---

## What I Built

**Overmind** is a multiplayer AI coding terminal — a production system where multiple developers connect to a shared WebSocket session and submit natural language prompts that are executed by AI agents against a live codebase. The system handles the full lifecycle: prompt coordination, scope analysis, safety evaluation, parallel multi-agent execution, merge conflict resolution, and pull request creation.

This is not a wrapper around an API. It is a distributed system with a type-safe protocol layer, dual execution backends, real-time event streaming, LLM observability, and production AWS infrastructure managed with Terraform.

---

## System Design Decisions

### 1. Protocol-First Architecture

Every WebSocket message is defined as a Zod discriminated union in `src/shared/protocol.ts`. There are 20+ message types covering the full session lifecycle:

```
join-ack → member-joined → prompt-queued → prompt-greenlit → 
host-review-request → prompt-approved → execution-plan-ready → 
execution-agent-update → execution-tool-activity → 
execution-agent-thinking → member-execution-complete → 
merge-update → merge-complete
```

Both client and server validate every message at the wire boundary. Invalid messages are logged and dropped — never propagated. This eliminates an entire class of bugs (malformed messages, type mismatches) at compile time and provides a self-documenting protocol.

**Why this matters**: Most real-time systems use ad-hoc JSON and discover protocol bugs in production. Zod discriminated unions give us the equivalent of protobuf's type safety with TypeScript's developer experience.

### 2. Deterministic Execution Ordering

Prompts enter a FIFO queue managed by the `Party` class. Execution is serial within a party — no two prompts execute concurrently against the same codebase. This is a deliberate constraint:

- Eliminates race conditions on file writes
- Makes merge conflicts detectable (conflict = this prompt changed a file that was also changed since queue entry)
- Provides a total ordering for audit logs

The tradeoff is throughput. For most teams (2-8 developers, prompts taking 30-120 seconds), serial execution with real-time streaming provides better UX than parallel execution with unpredictable conflicts.

### 3. Scope-Bounded Execution

Before any agent touches a file, Gemini analyzes the prompt against the file tree and returns a `ScopeResult`:

```typescript
interface ScopeResult {
  affectedFiles: string[];   // max 15 files
  complexity: "simple" | "moderate" | "complex";
}
```

This bounds the blast radius of any single prompt. An agent cannot modify files outside its scope. The host sees the scope before approving, creating a legible surface area for human review.

**Engineering detail**: Scope extraction uses Gemini's structured output (JSON schema mode) rather than free-text parsing. The schema enforces the 15-file limit at the model level, not just in post-processing.

### 4. Three-Layer Safety Model

```
Layer 1: Scope Extraction (limit what files can be touched)
Layer 2: Greenlight Evaluation (AI classifies prompt safety)  
Layer 3: Host Approval (human sees scope + greenlight, decides)
```

This is defense in depth. Each layer catches different failure modes:
- Scope prevents "refactor everything" from touching 500 files
- Greenlight catches "delete all test files" before execution
- Host approval catches anything the AI layers miss

### 5. Dual Execution Backends

**Local mode** (`OVERMIND_LOCAL=1`): A Gemini 2.0 Flash tool-calling loop running on the host machine. Three tools: `read_file`, `write_file`, `list_dir`. Max 25 rounds, 120-second timeout, 50KB file size limit. Simple, fast, no infrastructure required.

**Remote mode** (`OVERMIND_ORCHESTRATOR_URL`): A Python FastAPI service on ECS Fargate with a multi-agent architecture:

1. **Planner** (GPT-4o): Decomposes the prompt into named subtasks
2. **Subagents** (parallel): Each gets an isolated workspace copy and tools. Operates in a tool-calling loop until completion or max rounds.
3. **Evaluation** (GPT-4o): Reviews all subagent outputs. Can accept (`finish`) or trigger re-planning (`draft-plan`), creating an iterative refinement loop.

The orchestrator streams events over WebSocket in real-time. The TypeScript server maps Python snake_case events to the Zod-validated protocol and forwards them to the submitter's TUI.

### 6. AI Merge Resolution

When the merge pipeline detects conflicts (files modified by the current prompt that were also modified since the prompt was queued), it:

1. Reads `STORY.md` for cross-prompt feature context
2. Performs three-way merge resolution (base, ours, theirs) using AI
3. Assigns confidence scores to each resolution
4. Low-confidence resolutions are flagged — never silently applied
5. Commits to a new branch and opens a GitHub PR

The merge pipeline is implemented as an `AsyncGenerator<MergeExecutionEvent>`, enabling the TUI to render progress in real-time. The pipeline never throws — errors are yielded as events, keeping the calling code simple.

### 7. Feature Clustering (pgvector)

A story agent clusters related prompts into features using PostgreSQL with pgvector:

- Prompt embeddings are stored in a `queries` table
- Gemini classifies each new prompt: `assign_existing | create_new | reject`
- Related prompts are grouped into features with titles and descriptions
- A `STORY.md` file is maintained as a living document of team activity

This gives agents cross-prompt context. When Developer A adds authentication and Developer B adds auth tests, the story agent clusters them — so subsequent prompts see the full feature context.

### 8. Langfuse Observability

Every remote execution produces a hierarchical trace:

```
Root Trace (run_id, session_id, tags: [party_code])
├── Planning Span
│   └── LLM Generation (auto-captured: input/output tokens, latency, model)
├── Subagent Span (task_index=0, task_name="Create middleware")
│   ├── LLM Generation (tool-calling rounds)
│   └── Output: {rounds_used, files_changed, hit_max_rounds}
├── Subagent Span (task_index=1, ...)
│   └── ...
└── Evaluation Span
    └── Output: {decision: "finish" | "draft-plan"}
```

Token counts and costs are auto-captured via Langfuse's `AsyncOpenAI` drop-in wrapper. No manual instrumentation required for LLM calls — just swap the import.

### 9. Real-Time Streaming Architecture

```
Python orchestrator (asyncio.Queue)
  → WebSocket frame (JSON, snake_case)
  → TypeScript mapper (camelCase, typed)
  → Server event handler (protocol message)
  → WebSocket to client (Zod-validated)
  → TUI reducer (React state update)
  → Ink render (terminal output)
```

Eight event types: `plan-ready`, `agent-spawned`, `tool-use`, `tool-result`, `agent-thinking`, `agent-finished`, `run-complete`, `run-error`. Each maps to a specific TUI rendering: task panels, progress bars, tool activity lines, thinking text.

### 10. Infrastructure as Code

The full AWS stack is Terraform-managed:

| Resource | Purpose |
|---|---|
| ECS Cluster + Fargate Service | Container orchestration, auto-restart |
| Application Load Balancer | HTTP ingress, health checks |
| ECR Repository | Docker image registry |
| SSM Parameter Store | Secret management (API keys, DB URLs) |
| CloudWatch Log Group | Centralized logging |
| Security Groups | Network isolation (ALB ↔ ECS only) |

CI/CD: GitHub Actions builds Docker images on push, tags with `sha-<commit>` + `latest`, pushes to ECR. ECS pulls on deployment.

---

## Code Quality Indicators

| Metric | Value |
|---|---|
| Protocol types | 20+ Zod discriminated unions |
| Layer separation | `shared/` (0 side effects), `server/`, `client/`, `modal/` |
| Error handling | Never-throw merge pipeline, null-return parsers, graceful disconnect |
| Privacy | Server-enforced prompt isolation (submitter + host only) |
| Constants | All env-dependent values use lazy getter functions |
| File organization | Feature-organized (execution/, merge/, story/, orchestrator/) |

---

## What This Demonstrates

1. **Distributed systems design** — WebSocket protocol, event streaming, dual-backend execution, file synchronization
2. **AI/LLM engineering** — Multi-agent orchestration, tool-calling loops, structured output, evaluation pipelines, observability
3. **Production infrastructure** — Terraform IaC, ECS Fargate, ALB, ECR, CI/CD, secret management
4. **Type system mastery** — Zod discriminated unions as wire protocol, TypeScript strict mode, Python dataclasses
5. **System thinking** — Privacy invariants, safety layers, deterministic ordering, confidence-scored merges

---

*Built by Atharva. Full source: [github.com/atharva789/Overmind](https://github.com/atharva789/Overmind)*
