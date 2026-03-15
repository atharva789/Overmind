# Data Flow

This document traces how data moves through the Overmind system for the three critical flows: prompt submission and execution, codebase indexing, and merge conflict resolution.

## 1. Prompt Submission and Execution (Full Pipeline)

This is the primary data flow. A member submits a prompt, it is evaluated, the host approves it, and an AI agent executes code changes.

```mermaid
sequenceDiagram
    participant Member as Member (TUI)
    participant WS as WebSocket Server
    participant Party as Party
    participant DB as PostgreSQL
    participant Story as Story Agent
    participant Scope as Scope Extractor
    participant Gemini as Gemini API
    participant Agent as Execution Agent
    participant Host as Host (TUI)
    participant Others as Other Members

    Note over Member,Others: Phase 1: Prompt Submission
    Member->>WS: prompt-submit {promptId, content}
    WS->>Party: submitPrompt(connectionId, payload)
    Party-->>WS: PromptEntry {position}
    WS->>Member: prompt-queued {promptId, position}
    WS->>Others: activity {username, "submitted a prompt"}
    WS->>Others: member-status {username, "awaiting greenlight"}

    Note over Member,Others: Phase 2: Story Agent Evaluation
    WS->>DB: INSERT INTO queries (project_id, content, username)
    DB-->>WS: queryId
    WS->>Story: checkAndRunStoryAgent(projectRoot)
    Story->>DB: SELECT unclustered queries
    Story->>Gemini: Evaluate query (assign/create/reject)
    Gemini-->>Story: Decision JSON

    alt Query rejected
        Story->>DB: DELETE FROM queries
        WS->>Member: prompt-redlit {reasoning}
    else New feature created
        Story->>DB: INSERT INTO features
        Story->>DB: UPDATE queries SET feature_id
        Story->>DB: Regenerate STORY.md
        WS->>Member: feature-created {title}
    else Assigned to existing feature
        Story->>DB: UPDATE queries SET feature_id
        WS->>Member: prompt-greenlit {reasoning}
    end

    Note over Member,Others: Phase 3: Scope Extraction
    WS->>Scope: extractScope(prompt, projectRoot)
    Scope->>Scope: walkFiles (collect file tree)
    Scope->>Gemini: Identify affected files (structured output)
    Gemini-->>Scope: {affectedFiles[], complexity}
    Scope-->>WS: ScopeResult

    Note over Member,Others: Phase 4: Execution Dispatch
    WS->>Member: execution-queued

    alt Local Mode (OVERMIND_LOCAL=1)
        WS->>Agent: executePromptChanges(entry, partyCode)
        Agent->>Agent: collectProjectFiles (scope-based)
        Agent->>Gemini: Chat with tool-calling
        loop Tool-calling rounds (max 25)
            Gemini-->>Agent: functionCalls
            Agent->>Agent: executeTool (read/write/list)
            Agent->>Gemini: functionResponse
        end
        Gemini-->>Agent: finish_execution {summary}
        Agent-->>WS: ExecutionResult {files, summary}
    else Remote Mode (OVERMIND_ORCHESTRATOR_URL)
        WS->>WS: acquireLocks(affectedFiles)
        WS->>WS: packFiles (file-sync)
        WS->>WS: POST /runs to orchestrator
        loop Poll status (every 500ms)
            WS->>WS: GET /runs/{runId}
            WS->>Member: execution-update {stage}
        end
        WS->>WS: filterAllowedFiles
        WS->>WS: buildFileChanges (git diff)
        WS->>WS: applyChanges (write to disk)
    end

    Note over Member,Others: Phase 5: Completion
    WS->>Member: execution-complete {files, summary}
    WS->>Others: member-execution-complete {username, summary}
    WS->>Others: activity {username, "changes applied"}
    WS->>Others: member-status {username, "idle"}
```

## 2. Remote Execution (Python Orchestrator Detail)

When using the remote orchestrator, the Python FastAPI service manages the actual LLM interactions.

```mermaid
sequenceDiagram
    participant TS as TS Orchestrator
    participant API as FastAPI /runs
    participant Store as RunStore (memory)
    participant Planner as Planner Agent
    participant LLM as OpenAI-compat LLM
    participant Sub as Subagent Loop
    participant Tools as Agent Tools
    participant DB as PostgreSQL (pgvector)

    TS->>API: POST /runs {runId, prompt, files, scope, story}
    API->>Store: write_run_record (status: queued)
    API->>API: asyncio.create_task(run_worker)
    API-->>TS: {runId}

    Note over API,DB: Worker executes asynchronously
    API->>Store: mark_run_running
    API->>Planner: run_planner(client, user_query)
    Planner->>LLM: beta.chat.completions.parse (structured output)
    LLM-->>Planner: PlannerOutput {tasks[]}

    loop For each PlannerTask (parallel via asyncio.gather)
        Sub->>LLM: chat.completions.create (with tools)
        loop Tool-calling rounds (max 10)
            LLM-->>Sub: tool_calls
            alt read_file
                Sub->>Tools: Read from workspace or req_files
            else write_file
                Sub->>Tools: Write to workspace dict
            else search_files
                Sub->>Tools: Regex search across files
            else semantic_search
                Sub->>Tools: Generate embedding
                Tools->>DB: SELECT ... ORDER BY embedding <=> vector
                DB-->>Tools: ranked chunks
            else run_bash
                Sub->>Tools: asyncio.create_subprocess_shell
            else run_network
                Sub->>Tools: httpx request
            else subagent_finished
                Sub-->>Sub: Return AgentResult
            end
            Sub->>LLM: tool results
        end
    end

    Sub->>Store: mark_run_completed {files, summary}

    Note over TS,DB: TypeScript polls for completion
    TS->>API: GET /runs/{runId}
    API->>Store: read_run_record
    API-->>TS: {status: completed, files, summary}
```

## 3. Codebase Indexing Flow

On host startup, the TypeScript side sends all project files to the Python backend for AST-aware chunking and embedding.

```mermaid
sequenceDiagram
    participant CLI as CLI (host)
    participant Init as Codebase Initializer
    participant API as FastAPI /initialize_codebase
    participant Indexer as Codebase Indexer
    participant TS as tree-sitter
    participant Embed as fastembed (BAAI/bge-large)
    participant Store as Codebase Store
    participant DB as PostgreSQL + pgvector

    CLI->>Init: initializeCodebase(projectRoot, projectId, branch)
    Init->>Init: walkWorkspace (depth 4, exclude node_modules etc)
    Init->>API: POST /initialize_codebase {projectId, branchName, files}

    API->>Indexer: chunk_file(path, content) for each file
    Indexer->>TS: Parse AST (Python, TS, JS, Go, TSX)
    TS-->>Indexer: AST tree
    Indexer->>Indexer: Extract function/class/method chunks
    Indexer->>Indexer: Line-by-line chunks for uncovered lines
    Indexer-->>API: all_chunks[]

    API->>Embed: generate_embeddings_batch(chunk_texts)
    Embed-->>API: embeddings (1024-dim vectors)

    API->>Indexer: average_vectors(embeddings)
    API->>Store: resolve_similar_project(projectId, centroid)
    Store->>DB: SELECT project_id, cosine_similarity
    DB-->>Store: similar projects (threshold > 0.715)
    Store-->>API: resolvedProjectId

    API->>Store: upsert_branch_and_chunks(projectId, branch, chunks, embeddings)
    Store->>DB: INSERT INTO branches ON CONFLICT DO UPDATE
    Store->>DB: INSERT INTO code_chunks (bulk, ON CONFLICT DO NOTHING)
    DB-->>Store: branch_id

    API-->>Init: {resolvedProjectId, branchId, chunksStored}
```

## 4. Merge Conflict Resolution

The host triggers merge resolution via the `/merge` slash command.

```mermaid
sequenceDiagram
    participant Host as Host (TUI)
    participant WS as WebSocket Server
    participant Merge as Merge Index
    participant Git as Git (simple-git)
    participant Resolver as Conflict Resolver
    participant LLM as Modal/LLM endpoint
    participant GH as GitHub API

    Host->>WS: /merge command
    WS->>WS: merge-request message
    WS->>Host: merge-update {"Detecting conflicts..."}

    WS->>Merge: solveMergeConflicts(input, projectRoot)
    Merge->>Git: detectConflicts(projectRoot)
    Git-->>Merge: ConflictingFile[] (with raw markers)

    alt No conflicts
        Merge-->>WS: complete {resolutions: []}
    else Conflicts found
        Merge->>Host: merge-update {"Resolving N file(s)..."}
        loop For each conflicting file
            Merge->>Resolver: resolveFile(file, storyMd)
            Resolver->>LLM: POST /resolve {file, story}
            alt LLM success
                LLM-->>Resolver: {resolved_code, reasoning, confidence}
            else LLM failure (2 retries)
                Resolver->>Resolver: fallback (keep "ours" side)
            end
        end

        Merge->>Host: merge-update {"Applying resolutions..."}
        Merge->>Git: applyResolution for each file
        Merge->>Git: commitResolutions (new branch)

        Merge->>Host: merge-update {"Opening pull request..."}
        Merge->>GH: openPullRequest(branch, title, description)
        GH-->>Merge: prUrl

        Merge-->>WS: complete {resolutions, prUrl, branchName}
    end

    WS->>Host: merge-complete
    WS->>Host: activity {"Merge complete: N file(s) resolved"}
```

## 5. WebSocket Message Flow

All client-server communication uses Zod-validated discriminated unions.

```mermaid
flowchart LR
    subgraph ClientToServer["Client -> Server"]
        C1[join]
        C2[prompt-submit]
        C3[host-verdict]
        C4[status-update]
        C5[merge-request]
    end

    subgraph ServerToClient["Server -> Client"]
        S1[join-ack]
        S2[member-joined / member-left]
        S3[prompt-queued / greenlit / redlit]
        S4[prompt-approved / denied]
        S5[host-review-request]
        S6[feature-created]
        S7[execution-queued / update / complete]
        S8[member-execution-update / complete]
        S9[system-status]
        S10[activity / error / member-status]
        S11[merge-update / complete / error]
        S12[sandbox-status]
    end

    C1 -->|"join party"| S1
    C2 -->|"submit prompt"| S3
    C2 -->|"triggers"| S7
    C3 -->|"approve/deny"| S4
    C5 -->|"host only"| S11
```
