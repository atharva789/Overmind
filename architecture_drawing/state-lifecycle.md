# State Variable Lifecycles

This document tracks all significant state variables across the Overmind system, their creation, mutation, and destruction points.

## Server-Side State Variables

### Module-Level State (src/server/index.ts)

These are the core server maps that track all active state.

```mermaid
stateDiagram-v2
    state "parties: Map<string, Party>" as parties
    state "evalQueues: Map<string, Promise>" as evalQueues
    state "pendingParties: Map<string, string>" as pendingParties
    state "orchestrators: Map<string, Orchestrator>" as orchestrators
    state "pendingEvaluations: Map<string, EvaluationResult>" as pendingEvals
    state "pendingExecutions: Map<string, PendingExecution[]>" as pendingExec

    [*] --> pendingParties: reserveParty(hostUsername)
    pendingParties --> parties: handleJoin (host connects)
    parties --> [*]: handleDisconnect (host leaves)\nor shutdownAllParties()

    [*] --> evalQueues: enqueueEvaluation (first prompt)
    evalQueues --> [*]: handleDisconnect (host leaves)

    [*] --> orchestrators: handleJoin (host creates party)
    orchestrators --> [*]: handleDisconnect or shutdown

    [*] --> pendingEvals: enqueueEvaluation (story agent result)
    pendingEvals --> [*]: host-verdict (approve/deny)

    [*] --> pendingExec: backend offline
    pendingExec --> [*]: drainPendingExecutions (backend online)
```

### Party Lifecycle

```mermaid
stateDiagram-v2
    state "Party Created" as created
    state "Members Joining" as joining
    state "Active Session" as active
    state "Host Disconnected" as ended

    [*] --> created: reserveParty() + handleJoin()
    created --> joining: First member joins as host
    joining --> active: Members connect via partyCode
    active --> active: Prompts submitted & executed
    active --> ended: Host WebSocket closes
    ended --> [*]: All sockets closed, maps cleaned
```

### Prompt Lifecycle

```mermaid
stateDiagram-v2
    state "Submitted" as submitted
    state "In Evaluation Queue" as queued
    state "DB Inserted" as dbInserted
    state "Story Agent Evaluated" as evaluated
    state "Scope Extracted" as scoped
    state "Execution Queued" as execQueued
    state "Executing (Local)" as execLocal
    state "Executing (Remote)" as execRemote
    state "Complete" as complete
    state "Rejected" as rejected
    state "Denied by Host" as denied

    [*] --> submitted: prompt-submit message
    submitted --> queued: enqueueEvaluation()
    queued --> dbInserted: INSERT INTO queries
    dbInserted --> evaluated: checkAndRunStoryAgent()

    evaluated --> rejected: action=reject
    evaluated --> scoped: action=create_new or assign_existing
    rejected --> [*]: prompt-redlit

    scoped --> execQueued: extractScope() + enqueueExecution()
    execQueued --> execLocal: OVERMIND_LOCAL=1
    execQueued --> execRemote: OVERMIND_ORCHESTRATOR_URL set

    execLocal --> complete: executePromptChanges()
    execRemote --> complete: orchestrator.execute()
    complete --> [*]: execution-complete

    evaluated --> denied: host-verdict deny
    denied --> [*]: prompt-denied
```

### Run Store Record (Python: modal/run_store.py)

```mermaid
stateDiagram-v2
    state "queued" as q
    state "running" as r
    state "completed" as c
    state "failed" as f
    state "canceled" as x

    [*] --> q: write_run_record()
    q --> r: mark_run_running()
    r --> c: mark_run_completed()
    r --> f: mark_run_failed()
    q --> x: cancel_run (before start)
    r --> x: should_cancel() returns true
    c --> [*]
    f --> [*]
    x --> [*]
```

## Client-Side State Variables

### AppState Lifecycle (src/client/ui/App.tsx)

The entire TUI state is a single `useReducer` with immutable updates.

```mermaid
stateDiagram-v2
    state "Initial" as init
    state "Connected" as conn
    state "In Party" as party
    state "Prompt Active" as prompt
    state "Executing" as exec
    state "Viewing Member" as viewing
    state "Party Ended" as ended

    [*] --> init: App mounts
    init --> conn: CONNECTED action
    conn --> party: JOIN_ACK action
    party --> prompt: LOCAL_PROMPT_SUBMITTED
    prompt --> exec: EXECUTION_QUEUED
    exec --> party: EXECUTION_COMPLETE
    party --> viewing: SET_VIEWING (Ctrl+N)
    viewing --> party: SET_VIEWING(null)
    party --> ended: ERROR (HOST_DISCONNECTED / PARTY_ENDED)
    ended --> [*]: User presses any key
```

### Connection State (src/client/connection.ts)

```mermaid
stateDiagram-v2
    state "Disconnected" as disc
    state "Connecting" as connecting
    state "Connected" as conn
    state "Reconnecting" as recon
    state "Manually Disconnected" as manual

    [*] --> disc: new Connection()
    disc --> connecting: connect()
    connecting --> conn: WebSocket open
    conn --> disc: WebSocket close (auto-reconnect)
    disc --> recon: scheduleReconnect()
    recon --> connecting: setTimeout fires
    conn --> manual: disconnect()
    manual --> [*]
```

## Key State Variable Catalog

| Variable | Location | Type | Persistence | Importance | Created | Modified | Destroyed |
|----------|----------|------|-------------|------------|---------|----------|-----------|
| `parties` | server/index.ts | Map<string, Party> | Session | Critical | reserveParty+handleJoin | addMember/removeMember | handleDisconnect/shutdown |
| `evalQueues` | server/index.ts | Map<string, Promise> | Session | Critical | enqueueEvaluation | Promise chaining | handleDisconnect |
| `orchestrators` | server/index.ts | Map<string, Orchestrator> | Session | Critical | handleJoin (host) | execute() | handleDisconnect/shutdown |
| `pendingEvaluations` | server/index.ts | Map<string, EvalResult> | Session | Important | enqueueEvaluation | n/a | host-verdict |
| `pendingExecutions` | server/index.ts | Map<string, PendingExec[]> | Session | Important | backend offline | push() | drainPendingExecutions |
| `executionBackendAvailable` | server/index.ts | boolean | Session | Critical | initBridge() | health checks | n/a |
| `bridgeProcess` | server/index.ts | ChildProcess | Session | Important | spawnBridgeProcess | n/a | process exit/shutdown |
| `party.members` | server/party.ts | Map<string, Member> | Session | Critical | constructor | addMember/removeMember | Party destroyed |
| `party.promptQueue` | server/party.ts | PromptEntry[] | Session | Critical | constructor | submitPrompt/getNextPrompt | Party destroyed |
| `fileLocks` | orchestrator/index.ts | FileLockManager | Session | Critical | constructor | tryAcquire/release | shutdown |
| `activeExecutions` | orchestrator/index.ts | Map<string, AgentExec> | Session | Important | trackExecution | n/a | cancel/shutdown |
| `context.changes` | execution/tools.ts | FileChange[] | Temporary | Critical | constructor | executeTool(write_file) | function return |
| `AppState` | client/ui/App.tsx | useReducer | Session | Critical | initialState | reducer dispatch | unmount |
| `_pool` | server/db.ts | pg.Pool | Session | Critical | getPool() | n/a | process exit |
| `db_pool` | modal/orchestrator.py | asyncpg Pool | Session | Critical | lifespan startup | n/a | lifespan shutdown |
| `_store._data` | modal/run_store.py | dict | Session (volatile) | Critical | _MemoryStore() | put() | process restart |
| `_embedding_model` | modal/orchestrator.py | TextEmbedding | Session | Important | _get_embedding_model() | n/a | process exit |
| `_active_tasks` | modal/orchestrator.py | set[asyncio.Task] | Session | Important | module load | add/discard | process exit |
| `_parser_cache` | modal/codebase_indexer.py | dict | Session | Supplementary | _make_parser() | n/a | process exit |
| `features` | PostgreSQL | table | Persisted | Critical | Story Agent create_new | n/a | n/a (no delete path) |
| `queries` | PostgreSQL | table | Persisted | Critical | enqueueEvaluation INSERT | UPDATE feature_id | DELETE on reject |
| `branches` | PostgreSQL | table | Persisted | Important | initialize_codebase | UPSERT | n/a |
| `code_chunks` | PostgreSQL | table | Persisted | Important | initialize_codebase | INSERT (ON CONFLICT skip) | CASCADE on branch delete |
| `~/.overmind/projects/*.json` | filesystem | JSON | Persisted | Important | loadOrCreateProjectRecord | n/a (read-only after create) | manual delete |
| `STORY.md` | filesystem | Markdown | Persisted | Important | generateInitialStory | regenerateStoryMarkdown | n/a |
