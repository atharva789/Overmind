# Data Model

This document describes all data entities in Overmind, including database tables, TypeScript types, Python models, and their relationships.

## Database Schema (PostgreSQL + pgvector)

The database is optional. When `OVERMIND_DATABASE_URL` is set, the server initializes these tables via idempotent DDL in `src/server/db.ts`.

```mermaid
erDiagram
    features {
        UUID id PK "gen_random_uuid()"
        TEXT title "NOT NULL"
        TEXT description "NOT NULL"
        TIMESTAMPTZ created_at "DEFAULT NOW()"
        TEXT project_id "nullable"
    }

    queries {
        UUID id PK "gen_random_uuid()"
        TEXT content "NOT NULL"
        TEXT username "NOT NULL"
        TIMESTAMPTZ created_at "DEFAULT NOW()"
        UUID feature_id FK "nullable, ON DELETE SET NULL"
        TEXT project_id "nullable"
    }

    branches {
        UUID branch_id PK "gen_random_uuid()"
        TEXT name "NOT NULL"
        TEXT project_id "NOT NULL"
        TIMESTAMPTZ created_at "DEFAULT NOW()"
    }

    code_chunks {
        UUID id PK "gen_random_uuid()"
        TEXT project_id "NOT NULL"
        UUID branch_id FK "nullable, ON DELETE CASCADE"
        TEXT file_path "NOT NULL"
        TEXT file_hash "NOT NULL (MD5)"
        TEXT chunk_text "NOT NULL"
        TEXT chunk_name "nullable (path:QualifiedName)"
        INT start_line "nullable"
        INT end_line "nullable"
        VECTOR_1536 embedding "pgvector (1024-dim actual)"
        TIMESTAMPTZ created_at "DEFAULT NOW()"
    }

    features ||--o{ queries : "feature_id"
    branches ||--o{ code_chunks : "branch_id"
```

### Table Details

**features** -- Tracks feature clusters detected by the Story Agent. Each feature groups related user prompts.
- `project_id`: Derived from git remote URL or directory name via `deriveProjectId()`
- Created when Story Agent classifies a query as "create_new"

**queries** -- Every user prompt submitted through the WebSocket server. Linked to features after Story Agent clustering.
- `feature_id`: NULL until clustered, or deleted entirely if rejected as off-topic
- `content`: The raw prompt text (privacy-sensitive, never broadcast)

**branches** -- Tracks git branches for codebase indexing. One branch per (project_id, name) pair.
- UNIQUE constraint on `(project_id, name)`

**code_chunks** -- AST-aware code chunks with vector embeddings for semantic search.
- `chunk_name`: Qualified name like `src/foo.py:ClassName.method` or `src/foo.py:42` for line-level chunks
- `embedding`: 1024-dimensional vector from BAAI/bge-large-en-v1.5 (schema says VECTOR(1536) but actual model is 1024-dim)
- UNIQUE INDEX on `(project_id, file_path, start_line)`
- INDEX on `branch_id`

### Indexes

| Index | Table | Columns | Type |
|-------|-------|---------|------|
| `code_chunks_branch_id_idx` | code_chunks | branch_id | B-tree |
| `code_chunks_unique_chunk_idx` | code_chunks | (project_id, file_path, start_line) | Unique |

## TypeScript Protocol Types

All WebSocket messages are validated by Zod discriminated unions defined in `src/shared/protocol.ts`.

```mermaid
classDiagram
    class ClientMessage {
        <<discriminated union>>
        type: "join" | "prompt-submit" | "host-verdict" | "status-update" | "merge-request"
    }

    class JoinPayload {
        partyCode: string
        username: string
    }

    class PromptSubmitPayload {
        promptId: string
        content: string
        scope?: string[]
    }

    class HostVerdictPayload {
        promptId: string
        verdict: "approve" | "deny"
        reason?: string
    }

    class ServerMessage {
        <<discriminated union>>
        type: 21 variants
    }

    class FileChange {
        path: string
        diff: string
        linesAdded: number
        linesRemoved: number
    }

    class EvaluationResult {
        verdict: "greenlit" | "redlit"
        reasoning: string
        conflicts: string[]
        affectedFiles: string[]
        executionHints: ExecutionHints
    }

    class ExecutionHints {
        estimatedComplexity: "simple" | "moderate" | "complex"
        requiresBuild: boolean
        requiresTests: boolean
        relatedContextFiles: string[]
    }

    ClientMessage --> JoinPayload
    ClientMessage --> PromptSubmitPayload
    ClientMessage --> HostVerdictPayload
    ServerMessage --> FileChange
    EvaluationResult --> ExecutionHints
```

## TypeScript Server Types

```mermaid
classDiagram
    class Party {
        code: string
        hostId: string
        members: Map~string, Member~
        promptQueue: PromptEntry[]
        +addMember()
        +removeMember()
        +submitPrompt()
        +broadcast()
        +sendTo()
        +isHost()
    }

    class Member {
        connectionId: string
        username: string
        ws: WebSocket
    }

    class PromptEntry {
        promptId: string
        connectionId: string
        username: string
        content: string
        scope?: string[]
        position: number
    }

    class Orchestrator {
        -projectRoot: string
        -fileLocks: FileLockManager
        -activeExecutions: Map
        -workspace: WorkspaceFiles
        +execute() AsyncGenerator~ExecutionEvent~
        +cancel()
        +shutdown()
    }

    class ExecutionEvent {
        <<union>>
        type: queued | stage | agent-output | files-changed | complete | error
        stage?: string
        result?: object
        message?: string
    }

    class FileLock {
        promptId: string
        paths: string[]
        acquiredAt: number
    }

    class ProjectRecord {
        projectId: string
        branchName: string
        createdAt: string
    }

    Party --> Member
    Party --> PromptEntry
    Orchestrator --> FileLock
    Orchestrator --> ExecutionEvent
```

## Python Models

```mermaid
classDiagram
    class RunCreateRequest {
        runId: str
        promptId: str
        prompt: str
        story: str
        scope: list~str~
        files: dict~str, str~
    }

    class RunStatusRecord {
        status: str
        stage: Optional~str~
        detail: Optional~str~
        files: Optional~list~
        summary: Optional~str~
        error: Optional~str~
        updatedAt: str
    }

    class AgentResult {
        summary: str
        files: list~FileChange~
    }

    class FileChangePy {
        path: str
        content: str
    }

    class PlannerOutput {
        tasks: list~PlannerTask~
    }

    class PlannerTask {
        system_prompt: str
        user_prompt: str
    }

    class InitializeCodebaseRequest {
        projectId: str
        branchName: str
        files: dict~str, str~
    }

    class InitializeCodebaseResponse {
        resolvedProjectId: str
        branchId: str
        chunksStored: int
    }

    AgentResult --> FileChangePy
    PlannerOutput --> PlannerTask
    RunStatusRecord --> FileChangePy
```

## Merge Types

```mermaid
classDiagram
    class ConflictingFile {
        path: string
        rawContent: string
    }

    class FileResolution {
        path: string
        resolvedContent: string
        reasoning: string
        confidence: "high" | "medium" | "low"
        issues: string[]
    }

    class MergeResolutionResult {
        resolutions: FileResolution[]
        prTitle: string
        prDescription: string
        hasLowConfidence: boolean
        branchName: string
        prUrl?: string
    }

    class MergeConflictInput {
        conflictingFiles: ConflictingFile[]
        storyMd: string
        partyCode: string
    }

    class MergeExecutionEvent {
        <<union>>
        type: "stage" | "complete" | "error"
    }

    MergeConflictInput --> ConflictingFile
    MergeResolutionResult --> FileResolution
    MergeExecutionEvent --> MergeResolutionResult
```

## Client State (App.tsx)

The TUI state is managed by a single `useReducer` in `App.tsx`.

```mermaid
classDiagram
    class AppState {
        myUsername: string
        members: MemberView[]
        outputs: OutputEntry[]
        events: ActivityEvent[]
        connectionStatus: "connected" | "reconnecting" | "disconnected"
        currentPromptId: string | null
        promptContents: Record~string, string~
        isHost: boolean
        partyCode: string
        reviewQueue: ReviewRequest[]
        execution: ExecutionState | null
        memberExecutions: Record~string, ExecutionState~
        viewingMember: string | null
        executionBackendAvailable: boolean
        errorMessage: string | null
        partyEnded: boolean
        mergeInProgress: boolean
        mergeStage: string | null
    }

    class MemberView {
        username: string
        isHost: boolean
        status: string
    }

    class OutputEntry {
        id: string
        promptId: string
        status: OutputStatus
        message: string
        timestamp: number
        promptContent?: string
    }

    class ExecutionState {
        promptId: string
        stage: string | null
        files: FileChange[]
        summary: string | null
        completed: boolean
    }

    class ReviewRequest {
        promptId: string
        username: string
        content: string
        reasoning: string
        conflicts: string[]
    }

    AppState --> MemberView
    AppState --> OutputEntry
    AppState --> ExecutionState
    AppState --> ReviewRequest
```
