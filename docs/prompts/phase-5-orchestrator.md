# Phase 5: Orchestrator Agent (Modal-Powered Execution)

You are building the **Orchestrator Agent** for Overmind — the system that takes greenlit prompts and spawns isolated coding agents on **Modal Sandboxes** to implement the requested changes. Each agent runs in a remote container with the project files synced in, and the orchestrator collects diffs, validates results, and applies changes back to the host's local codebase.

Phases 1–4 are already implemented. Phase 4's execution stubs (mock spinners and hardcoded diffs) are being replaced with real Modal-backed agent execution.

## What is Modal?

Modal is a serverless cloud platform that lets you spawn isolated containers (called **Sandboxes**) on demand. Key properties:

- **Sandboxes** are secure containers created at runtime via the Modal Python SDK — you define the image, mount files, and exec commands inside them
- Containers cold-start in <1 second and can run for up to 24 hours
- You can stream stdout/stderr from sandbox commands in real time
- Sandboxes support custom images, volumes, environment variables, and resource specs
- Everything is controlled via Python — no Docker/K8s configuration

Overmind's server (TypeScript/Node) communicates with Modal through a **thin Python bridge service** that exposes a local HTTP API for sandbox lifecycle management.

## New Dependencies

Node side: `simple-git` (git operations for local diff/apply)
Python side: `modal` (Modal SDK), `fastapi`, `uvicorn` (bridge HTTP server)

## Architecture

```
src/server/orchestrator/
  index.ts              — Orchestrator class: manages execution lifecycle
  modal-client.ts       — HTTP client for the Modal bridge service
  file-sync.ts          — Packs/unpacks project files for sandbox transfer
  file-lock.ts          — File-level locking to prevent concurrent write conflicts
  result.ts             — Result types, diff parsing, validation

modal-bridge/
  bridge.py             — FastAPI server exposing sandbox management endpoints
  sandbox.py            — Modal Sandbox creation, command execution, file I/O
  agent_image.py        — Modal Image definitions (pre-built environments)
  requirements.txt      — modal, fastapi, uvicorn
```

## How It Works

```
  Greenlit Prompt
        │
        ▼
  ┌─────────────┐
  │ Orchestrator │──── checks file locks, claims affected files
  │  (Node/TS)   │
  └──────┬──────┘
         │  HTTP
         ▼
  ┌──────────────┐
  │ Modal Bridge │──── local Python process managing Modal API
  │  (FastAPI)   │
  └──────┬───────┘
         │  Modal SDK
         ▼
  ┌──────────────┐
  │ Modal        │──── remote container with project files mounted
  │ Sandbox      │──── coding agent runs inside (claude, etc.)
  │  (cloud)     │──── streams stdout/stderr back via bridge
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │  Diff        │──── compares sandbox files vs originals
  │  Extraction  │──── validates no out-of-scope changes
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐
  │  Apply &     │──── writes changed files to local project
  │  Cleanup     │──── releases file locks, terminates sandbox
  └──────────────┘
```

## Modal Bridge Service (`modal-bridge/`)

The bridge is a lightweight FastAPI process that the Overmind server starts as a child process. It translates HTTP requests into Modal SDK calls. This avoids embedding Python in the Node process and keeps the Modal integration cleanly separated.

### `bridge.py` — HTTP API

```python
from fastapi import FastAPI
import modal

app = FastAPI()

# POST /sandbox/create
# Body: { image: string, files: Record<path, content>, env: Record<string, string>, timeout_s: number }
# Returns: { sandbox_id: string }
#
# Creates a Modal Sandbox with the specified image, uploads project files into it,
# and sets environment variables. The sandbox stays alive until explicitly terminated
# or the timeout elapses.

# POST /sandbox/{id}/exec
# Body: { command: string[], workdir?: string, stream: boolean }
# Returns: SSE stream of { type: "stdout"|"stderr"|"exit", data: string }
#
# Executes a command inside a running sandbox. If stream=true, returns a
# Server-Sent Events stream of stdout/stderr lines. On command completion,
# sends an "exit" event with the exit code.

# GET /sandbox/{id}/files
# Query: ?paths=src/foo.ts,src/bar.ts  (comma-separated)
# Returns: { files: Record<path, content> }
#
# Reads file contents from the sandbox filesystem. Used after agent execution
# to extract changed files.

# GET /sandbox/{id}/diff
# Query: ?base_paths=src/foo.ts,src/bar.ts  (original file list)
# Body: { originals: Record<path, content> }  (original file contents)
# Returns: { changes: FileChange[] }
#
# Compares current sandbox files against the originals and returns unified diffs.
# Only diffs files in the provided list (scope enforcement).

# POST /sandbox/{id}/terminate
# Returns: { ok: true }
#
# Terminates the sandbox and releases all resources.

# GET /sandbox/{id}/status
# Returns: { status: "running"|"completed"|"error", uptime_s: number }

# GET /health
# Returns: { status: "ok", modal_connected: boolean }
```

### `sandbox.py` — Sandbox Lifecycle

```python
import modal

def create_sandbox(
    image_name: str,
    files: dict[str, str],
    env: dict[str, str],
    timeout_s: int = 300
) -> modal.Sandbox:
    """
    Create a Modal Sandbox with project files.

    1. Resolve the image (pre-built or on-the-fly)
    2. Write files into a temporary Modal Volume or use in-memory mounts
    3. Create the sandbox with the specified environment
    4. Return the sandbox handle for command execution
    """

    app = modal.App.lookup("overmind-agents", create_if_missing=True)
    image = get_or_build_image(image_name)

    sb = modal.Sandbox.create(
        image=image,
        app=app,
        timeout=timeout_s,
        encrypted_ports=[],
        env=env,
    )

    # Write project files into sandbox
    for path, content in files.items():
        sb.exec("sh", "-c", f"mkdir -p $(dirname /workspace/{path})")
        # Use stdin to write file content to avoid shell escaping issues
        proc = sb.exec("sh", "-c", f"cat > /workspace/{path}")
        proc.stdin.write(content.encode())
        proc.stdin.close()
        proc.wait()

    return sb


def exec_in_sandbox(
    sandbox: modal.Sandbox,
    command: list[str],
    workdir: str = "/workspace"
) -> Generator[dict, None, None]:
    """
    Execute a command in the sandbox, yielding stdout/stderr lines as they arrive.
    """
    proc = sandbox.exec(*command, workdir=workdir)

    # Stream output
    for line in proc.stdout:
        yield {"type": "stdout", "data": line}
    for line in proc.stderr:
        yield {"type": "stderr", "data": line}

    proc.wait()
    yield {"type": "exit", "data": str(proc.returncode)}
```

### `agent_image.py` — Pre-Built Images

```python
import modal

# Base image for coding agents — has Node, Python, git, common tools
agent_base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "ripgrep", "jq")
    .run_commands(
        # Install Node.js 22
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        # Install Claude Code CLI (default agent)
        "npm install -g @anthropic-ai/claude-code",
    )
    .pip_install("modal")
)

# Heavier image with build tools for prompts that need compilation
agent_build_image = agent_base_image.run_commands(
    "npm install -g typescript tsx",
    "apt-get install -y build-essential",
)

def get_or_build_image(image_name: str) -> modal.Image:
    images = {
        "base": agent_base_image,
        "build": agent_build_image,
    }
    return images.get(image_name, agent_base_image)
```

## Orchestrator Class (`index.ts`)

```typescript
class Orchestrator {
  private activeExecutions: Map<string, AgentExecution>;  // promptId -> execution
  private fileLocks: FileLockManager;
  private modalClient: ModalClient;
  private projectRoot: string;

  constructor(projectRoot: string, modalBridgeUrl: string);

  /**
   * Execute a greenlit prompt via Modal Sandbox.
   * Returns an async iterator of progress events for real-time UI updates.
   */
  async *execute(
    prompt: PromptEntry,
    evaluation: EvaluationResult
  ): AsyncGenerator<ExecutionEvent>;

  /**
   * Cancel a running execution — terminates the Modal Sandbox.
   */
  async cancel(promptId: string): Promise<void>;

  /**
   * Get status of all active executions.
   */
  getActiveExecutions(): AgentExecution[];

  /**
   * Graceful shutdown — terminate all sandboxes, release locks.
   */
  async shutdown(): Promise<void>;
}
```

### Execution flow inside `execute()`:

```typescript
async *execute(prompt, evaluation) {
  // 1. Acquire file locks
  yield { type: "stage", stage: "Acquiring file locks..." };
  const lockResult = this.fileLocks.tryAcquire(prompt.promptId, evaluation.affectedFiles);
  if (!lockResult.acquired) {
    yield { type: "stage", stage: "Waiting for file locks...", detail: "..." };
    // wait and retry (see concurrency model)
  }

  // 2. Pack project files for upload
  yield { type: "stage", stage: "Syncing project files to sandbox..." };
  const filePack = await this.packFiles(evaluation.affectedFiles, evaluation.executionHints);

  // 3. Create Modal Sandbox via bridge
  yield { type: "stage", stage: "Spawning sandbox..." };
  const sandboxId = await this.modalClient.createSandbox({
    image: evaluation.executionHints.requiresBuild ? "build" : "base",
    files: filePack,
    env: {
      OVERMIND_PROMPT: prompt.content,
      OVERMIND_PROMPT_ID: prompt.promptId,
      OVERMIND_SCOPE: evaluation.affectedFiles.join(","),
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
    },
    timeout_s: AGENT_TIMEOUT_S,
  });

  // 4. Execute coding agent inside sandbox — stream output
  yield { type: "stage", stage: "Agent is working..." };
  const agentCmd = buildAgentCommand(prompt);
  for await (const event of this.modalClient.execStream(sandboxId, agentCmd)) {
    if (event.type === "stdout" || event.type === "stderr") {
      yield { type: "agent-output", content: event.data };
    }
    if (event.type === "exit" && event.data !== "0") {
      yield { type: "error", message: "Agent exited with error", recoverable: false };
      await this.cleanup(sandboxId, prompt.promptId);
      return;
    }
  }

  // 5. Extract diffs from sandbox
  yield { type: "stage", stage: "Extracting changes..." };
  const changes = await this.modalClient.getDiff(sandboxId, filePack);

  // 6. Scope validation — only accept changes to allowed files
  const scopedChanges = changes.filter(c => evaluation.affectedFiles.includes(c.path));
  if (scopedChanges.length < changes.length) {
    // Log warning about out-of-scope changes
  }

  yield { type: "files-changed", files: scopedChanges };

  // 7. Apply changes locally
  yield { type: "stage", stage: "Applying changes to codebase..." };
  await this.applyChanges(scopedChanges);

  // 8. Optionally run tests/build if hinted
  if (evaluation.executionHints.requiresTests) {
    yield { type: "stage", stage: "Running tests in sandbox..." };
    for await (const event of this.modalClient.execStream(sandboxId, ["npm", "test"])) {
      yield { type: "agent-output", content: event.data };
    }
  }

  // 9. Cleanup
  yield { type: "stage", stage: "Cleaning up..." };
  await this.cleanup(sandboxId, prompt.promptId);

  yield {
    type: "complete",
    result: {
      promptId: prompt.promptId,
      files: scopedChanges,
      summary: `Applied ${scopedChanges.length} file(s)`,
      sandboxId,
    }
  };
}
```

### File packing (`file-sync.ts`):

```typescript
/**
 * Pack project files for upload to Modal Sandbox.
 *
 * Strategy:
 * - Always include: context.md files (root + subdirectories from hints)
 * - Always include: package.json, tsconfig.json (project config)
 * - Include: all files in affectedFiles list (the ones the agent will modify)
 * - Include: files imported by affected files (1 level of dependency tracing)
 * - Exclude: node_modules, .git, dist, .overmind
 *
 * Returns a Record<path, content> map ready for the bridge API.
 */
async function packFiles(
  affectedFiles: string[],
  hints: ExecutionHints,
  projectRoot: string
): Promise<Record<string, string>>
```

This is intentionally **not the entire repo**. Only the files the agent needs are synced, keeping sandbox creation fast. The greenlight agent's `affectedFiles` and `executionHints.relatedContextFiles` drive what gets packed.

For large projects, consider adding a `OVERMIND_ALWAYS_SYNC` env var with glob patterns for files that should always be synced (e.g., shared types, configs).

## Modal Client (`modal-client.ts`)

HTTP client that talks to the local bridge service.

```typescript
class ModalClient {
  constructor(private baseUrl: string);  // default: http://localhost:8377

  async createSandbox(config: SandboxConfig): Promise<string>;  // returns sandbox_id
  async *execStream(sandboxId: string, command: string[]): AsyncGenerator<StreamEvent>;
  async getFiles(sandboxId: string, paths: string[]): Promise<Record<string, string>>;
  async getDiff(sandboxId: string, originals: Record<string, string>): Promise<FileChange[]>;
  async terminate(sandboxId: string): Promise<void>;
  async getStatus(sandboxId: string): Promise<SandboxStatus>;
  async healthCheck(): Promise<{ modal_connected: boolean }>;
}
```

The client uses **Server-Sent Events** for `execStream` to get real-time output from sandbox commands without polling.

## File Lock Manager (`file-lock.ts`)

Same design as before — prevents two concurrent agents from modifying the same file. Locks are local and in-memory since all orchestration flows through a single Overmind server process.

```typescript
class FileLockManager {
  tryAcquire(promptId: string, paths: string[]): LockResult;
  release(promptId: string): void;
  getConflicts(paths: string[]): FileLock[];
}
```

- Atomic acquisition (all-or-nothing)
- Timeout: 5 minutes (remote agents take longer than local ones)
- On timeout: terminate the sandbox, release locks

## Integration with Server

### Starting the bridge:

The Overmind server (`src/server/index.ts`) starts the Modal bridge as a child process on party creation:

```typescript
// On "overmind host":
const bridge = spawn("python", ["-m", "uvicorn", "bridge:app", "--port", "8377"], {
  cwd: path.join(__dirname, "../../modal-bridge"),
  env: { ...process.env, MODAL_TOKEN_ID: "...", MODAL_TOKEN_SECRET: "..." },
});

// Wait for health check before accepting prompts
await waitForBridge("http://localhost:8377/health");
```

The bridge stays running for the lifetime of the party. On party shutdown, the bridge is killed and all sandboxes are terminated.

### Modified `party.ts`:

```typescript
async executePrompt(entry: PromptEntry, evaluation: EvaluationResult) {
  for await (const event of this.orchestrator.execute(entry, evaluation)) {
    switch (event.type) {
      case "stage":
        this.sendTo(entry.connectionId, {
          type: "execution-update",
          payload: { promptId: entry.promptId, stage: event.stage, detail: event.detail }
        });
        break;

      case "agent-output":
        // Only send if user has verbose mode enabled (future)
        break;

      case "complete":
        this.sendTo(entry.connectionId, {
          type: "execution-complete",
          payload: {
            promptId: entry.promptId,
            files: event.result.files,
            summary: event.result.summary
          }
        });
        this.broadcast({
          type: "activity",
          payload: {
            username: entry.username,
            event: `changes applied (${event.result.files.length} files)`,
            timestamp: Date.now()
          }
        });
        break;

      case "error":
        this.sendTo(entry.connectionId, {
          type: "error",
          payload: { message: event.message, code: "EXECUTION_FAILED" }
        });
        break;
    }
  }
}
```

### Protocol additions (`src/shared/protocol.ts`):

Add to existing messages:
- **Server → Client**: `execution-queued` — `{ promptId: string, reason: string }` — greenlit but waiting for file locks / sandbox slot
- **Server → Client**: `sandbox-status` — `{ promptId: string, sandboxId: string, status: string }` — sandbox lifecycle events (for debugging/verbose mode)

## Configuration

Add to `src/shared/constants.ts`:
```typescript
// Modal bridge
export const MODAL_BRIDGE_PORT = Number(process.env.OVERMIND_BRIDGE_PORT ?? "8377");
export const MODAL_BRIDGE_URL = `http://localhost:${MODAL_BRIDGE_PORT}`;

// Agent execution
export const AGENT_CMD = process.env.OVERMIND_AGENT_CMD ?? "claude";
export const AGENT_ARGS = (process.env.OVERMIND_AGENT_ARGS ?? "--dangerously-skip-permissions -p").split(" ");
export const AGENT_TIMEOUT_S = Number(process.env.OVERMIND_AGENT_TIMEOUT ?? "300");

// Concurrency
export const MAX_CONCURRENT_SANDBOXES = Number(process.env.OVERMIND_MAX_AGENTS ?? "3");
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes for remote execution

// File sync
export const ALWAYS_SYNC_PATTERNS = (process.env.OVERMIND_ALWAYS_SYNC ?? "context.md,package.json,tsconfig.json").split(",");
```

## Concurrency Model

- **Max concurrent sandboxes per party**: 3 (configurable via `OVERMIND_MAX_AGENTS`)
- Sandboxes run in parallel on Modal — they're fully isolated cloud containers
- File locks prevent two sandboxes from targeting the same files, even though they can't actually conflict at the filesystem level (each has its own copy). The locks prevent **apply-time conflicts** when writing results back to the host's local codebase.
- If all sandbox slots are full, new greenlit prompts queue with an `execution-queued` message
- FIFO ordering: prompts execute in submission order within lock constraints

## Local Fallback Mode

For development and testing without a Modal account, support a **local fallback** that uses the Phase 5 subprocess approach:

```typescript
// In Orchestrator constructor:
if (process.env.OVERMIND_LOCAL === "1") {
  // Skip bridge, spawn agents as local child_process instead
  // Use git worktrees for isolation (same as original Phase 5 design)
  this.mode = "local";
} else {
  this.mode = "modal";
}
```

The orchestrator interface (`execute()`, `cancel()`, `shutdown()`) stays identical — only the backend changes. This lets contributors develop without Modal credentials.

## Logging

Log all orchestrator activity to `orchestrator.log`:
- Sandbox creation (image, file count, env vars — redact API keys)
- Agent command and prompt (truncate prompt to first 100 chars)
- Sandbox exec start/stop with durations
- Lock acquisitions and releases
- Diff summaries (files changed, lines added/removed)
- Sandbox termination (clean vs timeout)
- Bridge health check results
- Errors at every stage

## .gitignore

Add to project `.gitignore`:
```
.overmind/
modal-bridge/__pycache__/
modal-bridge/.venv/
```

## Error Handling

- **Bridge unreachable**: Log error, set UI indicator "Modal bridge offline — execution unavailable". Queue prompts and retry bridge health check every 10s.
- **Sandbox creation fails**: Release locks, send error to submitter: "Could not create sandbox — check Modal credentials". Fall back to local mode if `OVERMIND_FALLBACK=1`.
- **Agent crashes (non-zero exit)**: Read last 20 lines of stderr from sandbox, terminate sandbox, release locks. Send error with stderr tail to submitter.
- **Agent timeout**: Terminate sandbox (Modal handles this), release locks. Send error: "Agent timed out after {n}s"
- **Diff extraction finds out-of-scope changes**: Log warning, exclude out-of-scope files, apply only in-scope changes.
- **Apply fails (local write error)**: Release locks, terminate sandbox. Send error: "Could not write changes to local files"
- **Bridge crashes**: Orchestrator detects via failed health checks, attempts to restart bridge process. All in-flight executions are considered failed.
- **Orchestrator shutdown**: Terminate all active sandboxes via bridge, release all locks, kill bridge process.

## Environment Variables Summary

| Variable | Required | Default | Description |
|---|---|---|---|
| `MODAL_TOKEN_ID` | Yes (unless local mode) | — | Modal API token ID |
| `MODAL_TOKEN_SECRET` | Yes (unless local mode) | — | Modal API token secret |
| `ANTHROPIC_API_KEY` | For default agent | — | Passed to sandbox for Claude agent |
| `OVERMIND_LOCAL` | No | `0` | Set to `1` for local subprocess mode |
| `OVERMIND_FALLBACK` | No | `0` | Set to `1` to auto-fallback to local on Modal failure |
| `OVERMIND_AGENT_CMD` | No | `claude` | Agent CLI command |
| `OVERMIND_AGENT_ARGS` | No | `--dangerously-skip-permissions -p` | Agent CLI arguments |
| `OVERMIND_AGENT_TIMEOUT` | No | `300` | Sandbox timeout in seconds |
| `OVERMIND_MAX_AGENTS` | No | `3` | Max concurrent sandboxes |
| `OVERMIND_BRIDGE_PORT` | No | `8377` | Modal bridge HTTP port |
| `OVERMIND_ALWAYS_SYNC` | No | `context.md,package.json,tsconfig.json` | Files always synced to sandbox |

## Verification

1. **Bridge health**: Start the bridge (`cd modal-bridge && uvicorn bridge:app --port 8377`), hit `/health` — confirms Modal connection
2. **Local fallback**: `OVERMIND_LOCAL=1 overmind host` — executes prompts via local subprocess, no Modal needed
3. **Modal execution**: Start a party, submit "Add a hello world endpoint"
   - See stages: "Syncing files..." → "Spawning sandbox..." → "Agent is working..." → "Extracting changes..." → "Applying..."
   - See actual diff in output view
   - Changes appear in local working directory
4. **Concurrent non-overlapping**: Submit 2 prompts targeting different files → both run in parallel sandboxes
5. **Concurrent overlapping**: Submit 2 prompts targeting the same file → second queues until first completes
6. **Agent failure**: Submit an impossible prompt → agent errors, sandbox terminated, locks released, clean error shown
7. **Timeout**: Set `OVERMIND_AGENT_TIMEOUT=5`, submit a complex prompt → times out, clean error
8. `cat orchestrator.log` shows the full execution trace including sandbox IDs
9. `npm run build` succeeds with no errors
