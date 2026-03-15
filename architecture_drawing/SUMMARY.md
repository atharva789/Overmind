# Overmind Architecture Summary

## 1. Project Overview

Overmind is a multiplayer AI coding terminal where multiple developers connect to a shared WebSocket session, submit natural language coding prompts, and an AI execution pipeline evaluates, plans, and executes code changes on the host's project files. It supports both local execution (Gemini tool-calling) and remote execution (planner-subagent architecture via a Python FastAPI orchestrator backed by an OpenAI-compatible LLM).

## 2. Architecture Style

**Layered monolith with a microservice-like backend boundary.** The TypeScript side (CLI, WebSocket server, TUI client) runs as a single Node.js process on the host machine. The Python orchestrator runs as a separate FastAPI service, communicating over HTTP. The system uses an event-driven pattern internally (WebSocket messages, AsyncGenerators for execution events) and a queue-per-party model for sequential prompt evaluation.

Key architectural patterns:
- **Discriminated union protocol** (Zod-validated WebSocket messages)
- **FIFO evaluation queues** (one Promise chain per party)
- **Planner-subagent execution** (structured decomposition into parallel subtasks)
- **File locking** (path-level locks prevent concurrent writes to same files)
- **AST-aware code indexing** (tree-sitter chunking + pgvector semantic search)

## 3. Key Components Table

| Component | File(s) | Responsibility | Dependencies |
|-----------|---------|----------------|--------------|
| CLI | `src/cli.ts` | Entry point: `host` and `join` commands, setup wizard, ngrok tunnel | server/index, client/session, shared/constants |
| WebSocket Server | `src/server/index.ts` | Connection management, party lifecycle, evaluation queue, execution dispatch | party, protocol, scope, agent, orchestrator, story, merge, db |
| Party | `src/server/party.ts` | Member tracking, prompt queue, message broadcast | protocol, constants |
| Scope Extractor | `src/server/execution/scope.ts` | Gemini-powered identification of affected files | Gemini API, file-sync |
| Local Agent | `src/server/execution/agent.ts` | Gemini tool-calling loop (read/write/list/finish) | tools.ts, file-sync |
| Workspace Tools | `src/server/execution/tools.ts` | Tool declarations and WorkspaceContext for file operations | Node fs, child_process |
| Orchestrator | `src/server/orchestrator/index.ts` | Remote execution: file locks, run creation, polling, file application | file-lock, file-sync, modal-orchestrator-client, workspace, allowlist |
| File Sync | `src/server/orchestrator/file-sync.ts` | Pack project files for remote execution | constants, protocol |
| File Lock | `src/server/orchestrator/file-lock.ts` | Path-level locking with timeout | constants |
| Modal Orchestrator Client | `src/server/orchestrator/modal-orchestrator-client.ts` | HTTP client: POST /runs, GET /runs/:id, POST cancel | Zod validation |
| Workspace Files | `src/server/orchestrator/workspace.ts` | Git diff generation, atomic file writes | simple-git |
| Merge Solver | `src/server/merge/index.ts` | Full conflict resolution pipeline: detect, resolve, commit, PR | resolver, git, github |
| Conflict Resolver | `src/server/merge/resolver.ts` | Calls LLM endpoint for conflict resolution with fallback | fetch |
| Story Agent | `src/server/story/agent.ts` | Clusters prompts into features via Gemini, regenerates STORY.md | db, Gemini API |
| DB Module | `src/server/db.ts` | PostgreSQL pool, idempotent schema DDL | pg |
| Project Store | `src/server/project-store.ts` | Persists project records to ~/.overmind/projects/ | Node fs |
| Codebase Initializer | `src/server/codebase-initializer.ts` | Sends project files to orchestrator for indexing | fetch |
| App (TUI) | `src/client/ui/App.tsx` | useReducer state owner, server message router | Connection, Session, UI panels |
| Connection | `src/client/connection.ts` | WebSocket wrapper with auto-reconnect and exponential backoff | ws, protocol |
| Session | `src/client/session.ts` | High-level client API: join, submit prompt, send verdict | Connection |
| Protocol | `src/shared/protocol.ts` | Zod schemas for all client/server messages | zod |
| Constants | `src/shared/constants.ts` | Ports, timeouts, env helpers (lazy reads) | None |
| FastAPI Orchestrator | `modal/orchestrator.py` | Run management, planner/subagent execution, codebase indexing | agent_tools, agent_schemas, codebase_indexer, codebase_store, run_store |
| Agent Tools | `modal/agent_tools.py` | Tool schemas and async handlers: read, write, search, bash, network | httpx, asyncio |
| Agent Schemas | `modal/agent_schemas.py` | Pydantic models: PlannerTask, PlannerOutput | pydantic |
| Codebase Indexer | `modal/codebase_indexer.py` | tree-sitter AST chunking, vector averaging, cosine similarity | tree-sitter, numpy |
| Codebase Store | `modal/codebase_store.py` | asyncpg DB helpers: upsert branches, bulk-insert chunks, resolve similar projects | asyncpg |
| Run Store | `modal/run_store.py` | In-memory run lifecycle records with Pydantic models | pydantic |
| Lambda Endpoint Killer | `deploy/lambda-endpoint-killer/lambda_function.py` | Auto-delete SageMaker endpoints on CloudWatch billing alarm | boto3 |
| Deploy SageMaker | `deploy/scripts/deploy_sagemeker.py` | Deploy Qwen model to SageMaker endpoint | sagemaker SDK |

## 4. Functions Catalog

### src/cli.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `host` action | `async (opts) => void` | Start server, setup wizard, create party, render TUI |
| `join` action | `(code, opts) => void` | Connect to existing party, render TUI |
| `getCurrentBranch` | `(projectRoot: string) => string` | Get git branch name via `git rev-parse` |
| `getDefaultUsername` | `() => string` | Derive username from OS user info |
| `showBanner` | `(code, maxMem, inviteCode?) => void` | Print ASCII art banner |
| `buildServerInput` | `(host, port) => string` | Normalize server URL input |
| `normalizeServerUrl` | `(input: string) => string` | Convert various URL schemes to ws:// |
| `startNgrokTunnel` | `(port: number) => Promise<string>` | Start ngrok TCP tunnel |
| `stopNgrokTunnel` | `(url: string|null) => Promise<void>` | Disconnect and kill ngrok |

### src/server/index.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `startServer` | `() => WebSocketServer` | Initialize WS server, bridge health checks, DB, story agent |
| `reserveParty` | `(hostUsername: string) => string` | Pre-allocate a party code for the host |
| `setMaxMembers` | `(n: number) => void` | Configure max members per party |
| `shutdownAllParties` | `() => void` | Gracefully close all parties, bridges, orchestrators |
| `handleJoin` | `(ws, connectionId, msg, timeout, onJoined) => void` | Process join message, create or join party |
| `handleMessage` | `(party, connectionId, msg) => void` | Route client messages: prompt-submit, host-verdict, merge-request |
| `handleDisconnect` | `(party, connectionId) => void` | Clean up member, close party if host left |
| `enqueueEvaluation` | `(party, connectionId, entry) => void` | Sequential eval queue: DB insert, story agent, scope, execution |
| `enqueueExecution` | `(party, entry, evaluation) => void` | Queue or start execution depending on backend availability |
| `runExecutionFlow` | `(party, entry, evaluation) => Promise<void>` | Execute prompt via local agent or remote orchestrator |
| `handleExecutionEvent` | `(party, entry, event) => void` | Map execution events to protocol messages |
| `initBridge` | `() => Promise<void>` | Start bridge/orchestrator health checks |
| `checkRemoteOrchestratorHealth` | `() => Promise<void>` | HTTP health check to orchestrator |
| `drainPendingExecutions` | `() => void` | Execute queued prompts when backend comes online |
| `buildFallbackEvaluation` | `(entry, reason) => EvaluationResult` | Minimal evaluation when host approves without metadata |

### src/server/party.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `Party.constructor` | `(connectionId, hostWs, hostUsername)` | Create party with host as first member |
| `Party.addMember` | `(ws, username, connectionId) => string` | Add member with conflict-free username |
| `Party.removeMember` | `(connectionId) => void` | Remove member from party |
| `Party.submitPrompt` | `(connectionId, prompt) => PromptEntry` | Queue a prompt and increment counter |
| `Party.broadcast` | `(message, excludeId?) => void` | Send to all members (optionally excluding one) |
| `Party.sendTo` | `(connectionId, message) => void` | Send to a specific member |
| `Party.isHost` | `(connectionId) => boolean` | Check if connection is the host |

### src/server/execution/agent.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `executePromptChanges` | `(entry, partyCode, log) => Promise<ExecutionResult>` | Run Gemini tool-calling loop, return file changes |
| `collectProjectFiles` | `(projectRoot, scopeFiles?) => Record<string,string>` | Read project files (scoped or full walk) |
| `buildSystemPrompt` | `() => string` | System prompt instructing Gemini to use tools |
| `withTimeout` | `(promise, ms) => Promise<T>` | Race promise against a timeout |

### src/server/execution/scope.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `extractScope` | `(prompt, projectRoot) => Promise<ScopeResult>` | Ask Gemini which files a prompt affects |

### src/server/execution/tools.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `WorkspaceContext.executeTool` | `(name, args) => {success, result?, error?}` | Dispatch tool call: read_file, write_file, list_dir, finish |

### src/server/orchestrator/index.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `Orchestrator.execute` | `(prompt, eval) => AsyncGenerator<ExecutionEvent>` | Full remote execution: lock, sync, spawn, poll, apply |
| `Orchestrator.cancel` | `(promptId) => Promise<void>` | Cancel an active execution |
| `Orchestrator.shutdown` | `() => Promise<void>` | Release all locks and clear active executions |

### src/server/orchestrator/file-sync.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `packFiles` | `(projectRoot, evaluation, patterns) => FilePack` | Collect required files based on scope and patterns |
| `walkFiles` | `(root, relative, depth, onFile) => void` | Recursive directory walk with exclusions |

### src/server/orchestrator/file-lock.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `FileLockManager.tryAcquire` | `(promptId, paths) => LockResult` | Atomically acquire locks if no conflicts |
| `FileLockManager.release` | `(promptId) => void` | Release all locks for a prompt |
| `FileLockManager.getConflicts` | `(paths) => FileLock[]` | Check for path overlaps with active locks |

### src/server/orchestrator/modal-orchestrator-client.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `ModalOrchestratorClient.createRun` | `(payload) => Promise<string>` | POST /runs to create a new execution run |
| `ModalOrchestratorClient.getRun` | `(runId) => Promise<RunStatus>` | GET /runs/:id to poll run status |
| `ModalOrchestratorClient.cancelRun` | `(runId) => Promise<void>` | POST /runs/:id/cancel to cancel a run |

### src/server/orchestrator/workspace.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `WorkspaceFiles.buildFileChanges` | `(originals, updated) => Promise<FileChange[]>` | Generate git diffs between originals and updates |
| `WorkspaceFiles.applyChanges` | `(updatedFiles) => Promise<void>` | Write updated files to disk atomically |
| `WorkspaceFiles.loadStory` | `(default, log) => string` | Read STORY.md or return default |

### src/server/merge/index.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `solveMergeConflicts` | `(input, projectRoot) => AsyncGenerator<MergeExecutionEvent>` | Full pipeline: detect, resolve, commit, PR |

### src/server/merge/resolver.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `resolveFile` | `(file, storyMd) => Promise<FileResolution>` | Resolve one file via LLM with retry and fallback |
| `resolveAllConflicts` | `(files, storyMd) => Promise<FileResolution[]>` | Sequentially resolve all conflicting files |

### src/server/story/agent.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `checkAndRunStoryAgent` | `(projectRoot) => Promise<results[]>` | Cluster unclustered queries, regenerate STORY.md |
| `generateInitialStory` | `(ai, model, root, projectId, context) => Promise<void>` | Generate initial STORY.md from codebase context |
| `regenerateStoryMarkdown` | `(projectRoot, projectId) => Promise<void>` | Rebuild STORY.md from all features in DB |

### src/server/db.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `getPool` | `() => pg.Pool` | Lazy-initialize PostgreSQL connection pool |
| `initDb` | `() => Promise<void>` | Run idempotent DDL for all tables and indexes |

### src/server/project-store.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `loadOrCreateProjectRecord` | `(projectId, branchName) => ProjectRecord` | Read or create ~/.overmind/projects/<id>.json |

### src/server/codebase-initializer.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `initializeCodebase` | `(root, projectId, branch) => Promise<Result|null>` | POST files to orchestrator /initialize_codebase |

### src/client/connection.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `Connection.connect` | `() => void` | Open WebSocket connection |
| `Connection.send` | `(data: object) => void` | Send JSON message |
| `Connection.disconnect` | `() => void` | Close connection, stop reconnecting |
| `Connection.onMessage` | `(handler) => void` | Type-safe ServerMessage listener |

### src/client/session.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `Session.connect` | `() => void` | Connect and auto-send join message |
| `Session.submitPrompt` | `(promptId, content, scope?) => void` | Send prompt-submit message |
| `Session.sendVerdict` | `(promptId, verdict, reason?) => void` | Send host-verdict message |
| `Session.sendStatusUpdate` | `(status) => void` | Send typing/idle status |

### src/shared/protocol.ts

| Function | Signature | Purpose |
|----------|-----------|---------|
| `parseClientMessage` | `(data: unknown) => ClientMessage|null` | Validate and parse client message |
| `parseServerMessage` | `(data: unknown) => ServerMessage|null` | Validate and parse server message |

### modal/orchestrator.py

| Function | Signature | Purpose |
|----------|-----------|---------|
| `health` | `GET /health` | Check LLM reachability |
| `create_run` | `POST /runs` | Enqueue run and spawn worker task |
| `get_run` | `GET /runs/{run_id}` | Return current run status |
| `cancel_run` | `POST /runs/{run_id}/cancel` | Cancel a run |
| `initialize_codebase` | `POST /initialize_codebase` | Chunk, embed, and store project files |
| `run_worker` | `(run_id, req) => None` | Execute agent loop and persist result |
| `run_planner` | `(client, user_query) => PlannerOutput` | Decompose query into subtasks via structured output |
| `subagent_loop` | `(client, ctx, task, files, run_id) => AgentResult` | Tool-calling loop for one subtask |
| `agent_loop` | `(client, ctx, tasks, files, run_id) => AgentResult` | Run all subagents in parallel via asyncio.gather |
| `generate_embedding` | `(text) => list[float]` | Single text embedding via fastembed |
| `generate_embeddings_batch` | `(texts) => list[list[float]]` | Batch embedding in thread pool |

### modal/agent_tools.py

| Function | Signature | Purpose |
|----------|-----------|---------|
| `build_agent_user_message` | `(req) => str` | Build initial prompt from run request |
| `execute_tool` | `(name, args, req_files, workspace, ctx) => str` | Dispatch tool call to handler |
| `_read_file` | `(args, req_files, workspace, ctx) => str` | Read from workspace or request files |
| `_write_file` | `(args, req_files, workspace, ctx) => str` | Write to workspace dict |
| `_list_files` | `(args, req_files, workspace, ctx) => str` | List all available file paths |
| `_search_files` | `(args, req_files, workspace, ctx) => str` | Regex search across all files |
| `_semantic_search` | `(args, req_files, workspace, ctx) => str` | Vector similarity search via pgvector |
| `_run_bash` | `(args, req_files, workspace, ctx) => str` | Execute shell command |
| `_run_network` | `(args, req_files, workspace, ctx) => str` | Make HTTP request |

### modal/codebase_indexer.py

| Function | Signature | Purpose |
|----------|-----------|---------|
| `chunk_file` | `(path, content) => list[dict]` | AST-aware chunking with tree-sitter fallback to line-by-line |
| `average_vectors` | `(vectors) => list[float]` | Element-wise average of float vectors |
| `cosine_similarity` | `(a, b) => float` | Cosine similarity between two vectors |

### modal/codebase_store.py

| Function | Signature | Purpose |
|----------|-----------|---------|
| `resolve_similar_project` | `(pool, id, centroid) => str` | Find most similar existing project by embedding centroid |
| `upsert_branch_and_chunks` | `(pool, id, branch, chunks, embeddings, hashes) => (str, int)` | Bulk insert code chunks in a single transaction |
| `upsert_branch_only` | `(pool, id, branch) => str` | Upsert branch without touching chunks |

### modal/run_store.py

| Function | Signature | Purpose |
|----------|-----------|---------|
| `run_exists` | `(run_id) => bool` | Check if run record exists |
| `read_run_record` | `(run_id) => RunStatusRecord` | Load and validate run record |
| `write_run_record` | `(run_id, record) => None` | Persist run record |
| `update_run_record` | `(run_id, updates) => None` | Merge updates into existing record |
| `should_cancel` | `(run_id) => bool` | Check if run is marked canceled |
| `mark_run_running` | `(run_id) => None` | Transition to running state |
| `mark_run_completed` | `(run_id, result) => None` | Transition to completed with files |
| `mark_run_failed` | `(run_id, stage, detail, error) => None` | Transition to failed state |
| `mark_run_canceled` | `(run_id, detail) => None` | Transition to canceled state |

## 5. State Variables Catalog

See [state-lifecycle.md](./state-lifecycle.md) for full lifecycle diagrams.

| Variable | Type | Location | Persistence | Importance | Lifecycle Summary |
|----------|------|----------|-------------|------------|-------------------|
| `parties` | Map<string, Party> | server/index.ts | Session | Critical | Created on host join, destroyed on host disconnect or shutdown |
| `evalQueues` | Map<string, Promise> | server/index.ts | Session | Critical | One per party, chains sequential evaluations |
| `orchestrators` | Map<string, Orchestrator> | server/index.ts | Session | Critical | One per party, manages remote execution |
| `pendingEvaluations` | Map<string, EvalResult> | server/index.ts | Session | Important | Stored after scope extraction, consumed on host verdict |
| `pendingExecutions` | Map<string, PendingExec[]> | server/index.ts | Session | Important | Buffered when backend offline, drained when online |
| `executionBackendAvailable` | boolean | server/index.ts | Session | Critical | Updated by periodic health checks (10s interval) |
| `party.members` | Map<string, Member> | server/party.ts | Session | Critical | Grows on join, shrinks on disconnect |
| `party.promptQueue` | PromptEntry[] | server/party.ts | Session | Critical | Appended on prompt-submit |
| `fileLocks` | FileLockManager | orchestrator/index.ts | Session | Critical | Acquired per prompt, released after execution |
| `context.changes` | FileChange[] | execution/tools.ts | Temporary | Critical | Accumulated during one execution, returned as result |
| `AppState` | useReducer | client/ui/App.tsx | Session | Critical | Full TUI state: members, outputs, execution, reviews |
| `db_pool` | asyncpg Pool | orchestrator.py | Session | Critical | Created on FastAPI startup, closed on shutdown |
| `_store._data` | dict | run_store.py | Session (volatile) | Critical | In-memory run records, lost on restart |
| `features` | DB table | PostgreSQL | Persisted | Critical | Story Agent creates, never deleted |
| `queries` | DB table | PostgreSQL | Persisted | Critical | Every prompt inserted, rejected ones deleted |
| `code_chunks` | DB table | PostgreSQL | Persisted | Important | Bulk-inserted on codebase init, ON CONFLICT skip |
| `STORY.md` | file | project root | Persisted | Important | Generated/regenerated by Story Agent |

## 6. Data Model Summary

The system has four persistent database tables and several runtime data structures.

**Database entities**: `features` and `queries` form a one-to-many relationship (features cluster related queries). `branches` and `code_chunks` support semantic code search (branches group chunks per git branch, chunks store AST-aware code snippets with embedding vectors). Project similarity is detected by comparing embedding centroids across projects.

**Protocol types**: All WebSocket communication uses Zod-validated discriminated unions (5 client message types, 21 server message types). Messages are validated on both send and receive sides. Invalid messages are silently dropped.

**Execution types**: `RunCreateRequest` flows from TypeScript to Python (via HTTP POST). `RunStatusRecord` is polled via HTTP GET. `AgentResult` contains the workspace files modified by the agent.

## 7. Critical Paths

### Path 1: Prompt-to-Code-Change (Local Mode)
1. Client sends `prompt-submit` via WebSocket
2. Server inserts query into PostgreSQL, runs Story Agent (Gemini classify/cluster)
3. Story Agent rejects off-topic queries or clusters into features
4. Scope Extractor (Gemini) identifies affected files
5. Local Agent (Gemini tool-calling) reads files, makes changes, calls finish
6. Server sends `execution-complete` with file diffs to submitter
7. Server broadcasts sanitized activity to other members

### Path 2: Prompt-to-Code-Change (Remote Mode)
1. Same as Path 1 through step 4
2. Orchestrator acquires file locks, packs files, POSTs to Python /runs
3. Python run_worker starts: Planner decomposes prompt into subtasks
4. Subagents execute in parallel (asyncio.gather), each with tool-calling loop
5. Python marks run completed with modified file list
6. TypeScript polls /runs/:id, receives completed status
7. Orchestrator filters allowed files, generates git diffs, writes to disk
8. Server sends `execution-complete`

### Path 3: Host Startup
1. CLI derives project ID from git remote, loads/creates project record
2. CLI initializes database (idempotent DDL)
3. CLI sends project files to orchestrator for AST chunking + embedding
4. CLI checks if features table is empty; if so, runs setup wizard
5. WebSocket server starts, bridge health checks begin
6. Party code is reserved, ngrok tunnel started
7. Host auto-joins as first member, TUI renders

### Path 4: Merge Conflict Resolution
1. Host sends `/merge` slash command
2. Git detects conflicting files (with <<<<<<< markers)
3. Each file sent to LLM for resolution (sequential, 2 retries, fallback to "ours")
4. Resolutions applied to disk, committed to new branch
5. GitHub PR opened with description (no prompt content)

## 8. Diagram Index

| Diagram | File | Description |
|---------|------|-------------|
| System Overview | [system-overview.md](./system-overview.md) | High-level architecture: all components, layers, and external services |
| Data Flow - Execution | [data-flow.md](./data-flow.md#1-prompt-submission-and-execution-full-pipeline) | Full prompt-to-code-change pipeline sequence diagram |
| Data Flow - Remote Agent | [data-flow.md](./data-flow.md#2-remote-execution-python-orchestrator-detail) | Python planner/subagent execution detail |
| Data Flow - Indexing | [data-flow.md](./data-flow.md#3-codebase-indexing-flow) | AST chunking and embedding storage flow |
| Data Flow - Merge | [data-flow.md](./data-flow.md#4-merge-conflict-resolution) | Conflict detection through PR creation |
| Data Flow - Messages | [data-flow.md](./data-flow.md#5-websocket-message-flow) | Client/server message type catalog |
| Data Model - DB Schema | [data-model.md](./data-model.md#database-schema-postgresql--pgvector) | ER diagram of all database tables |
| Data Model - Protocol | [data-model.md](./data-model.md#typescript-protocol-types) | Zod schema class diagram |
| Data Model - Server Types | [data-model.md](./data-model.md#typescript-server-types) | Party, Orchestrator, execution types |
| Data Model - Python Models | [data-model.md](./data-model.md#python-models) | Pydantic models for orchestrator |
| Data Model - Client State | [data-model.md](./data-model.md#client-state-apptsx) | AppState useReducer structure |
| State Lifecycle - Server | [state-lifecycle.md](./state-lifecycle.md#server-side-state-variables) | Module-level state maps lifecycle |
| State Lifecycle - Party | [state-lifecycle.md](./state-lifecycle.md#party-lifecycle) | Party creation through destruction |
| State Lifecycle - Prompt | [state-lifecycle.md](./state-lifecycle.md#prompt-lifecycle) | Full prompt state machine |
| State Lifecycle - Run | [state-lifecycle.md](./state-lifecycle.md#run-store-record-python-modalrun_storepy) | Python run record state machine |
| State Lifecycle - Client | [state-lifecycle.md](./state-lifecycle.md#appstate-lifecycle-srcclientuiapptsx) | TUI state transitions |
| Module Dependencies - TS | [module-dependencies.md](./module-dependencies.md#typescript-layer-dependencies) | Full TypeScript import graph |
| Module Dependencies - Python | [module-dependencies.md](./module-dependencies.md#python-layer-dependencies) | Python module import graph |
| Module Dependencies - Cross | [module-dependencies.md](./module-dependencies.md#cross-layer-communication) | HTTP boundary between TS and Python |

## 9. Architecture Decisions and Notes

### Design Decisions

1. **Sequential evaluation queue per party**: Prompts are evaluated one at a time per party (Promise chain). This prevents race conditions in DB inserts and ensures deterministic ordering, but limits throughput to one evaluation at a time.

2. **Planner-subagent architecture**: The Python orchestrator uses a structured decomposition pattern -- a planner agent breaks the prompt into independent tasks, then subagents execute in parallel via `asyncio.gather`. This is a recent addition (replaces a single flat agent loop).

3. **File locking with timeout**: The orchestrator acquires path-level locks before execution to prevent concurrent modifications to the same files. Locks auto-expire after 5 minutes to prevent deadlocks.

4. **Privacy invariant (critical)**: Prompt content is NEVER broadcast to other party members. Only the submitter and the host see it. This is enforced server-side by using `sendTo` for prompt-related messages and sanitized `activity` for broadcast.

5. **Dual execution backends**: Local mode uses Gemini's tool-calling API directly from the TypeScript process. Remote mode delegates to the Python FastAPI orchestrator which uses an OpenAI-compatible API. This allows flexibility between quick local development and scalable remote execution.

6. **AST-aware code chunking**: The codebase indexer uses tree-sitter to extract functions, classes, and methods as named chunks (e.g., `src/foo.py:ClassName.method`). Lines not covered by AST definitions become individual line-level chunks. This gives semantic search better granularity than naive line splitting.

7. **In-memory run store**: The Python run store currently uses an in-process dict (`_MemoryStore`). This is explicitly designed for swapping to DynamoDB or another backend via the `RUN_STORE_BACKEND` env var.

### Potential Issues and Observations

1. **`agent_loop` is incomplete**: The `agent_loop` function in `orchestrator.py` runs all subagents in parallel but does not aggregate their results properly -- it returns an empty `AgentResult` instead of merging subagent outputs. The TODO comment says "You will write this part!"

2. **Embedding dimension mismatch**: The DB schema declares `VECTOR(1536)` but the actual embedding model (`BAAI/bge-large-en-v1.5`) produces 1024-dimensional vectors. This may cause errors on INSERT if pgvector enforces dimension constraints, or it may silently zero-pad.

3. **No authentication on Python API**: The FastAPI orchestrator has no authentication headers or API key validation. Any client that knows the URL can create runs, cancel them, or submit codebase indexing requests.

4. **Single-process Python run store**: All run records live in memory. If the Python process restarts, all run state is lost. Active TypeScript orchestrators polling those runs will receive 404s.

5. **Merge resolver URL is separate from orchestrator URL**: The conflict resolver endpoint (`CONFLICT_RESOLVER_URL`) is a completely separate service from the main orchestrator. It appears to be a legacy Modal endpoint that may need to be consolidated.

6. **Modal bridge is legacy**: The `modal-bridge/` directory and `ModalClient` (modal-client.ts) appear to be the old execution path before the orchestrator was built. The server still has `spawnBridgeProcess()` as a fallback when neither local mode nor orchestrator URL are configured.

7. **No rate limiting on WebSocket messages**: The server processes all valid messages without rate limiting. A malicious client could flood the evaluation queue.

8. **Story Agent calls Gemini on every prompt**: Each prompt triggers a Gemini API call for clustering. With high prompt throughput, this could hit rate limits (the code handles 429s gracefully by skipping).
