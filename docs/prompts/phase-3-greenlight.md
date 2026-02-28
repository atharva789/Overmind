# Phase 3: Greenlight Agent (Dual Backend, Modal GLM Primary + Gemini Fallback)

Phase 1 and Phase 2 are complete.

Replace the mock 2-second auto-greenlit logic with a real Greenlight Agent.

The Greenlight Agent must support two backends:

Primary backend: GLM 5.0 running in a Modal Sandbox (offline, compute hosted)

Fallback backend: Gemini tool-use running locally via @google/generative-ai

Both backends must produce the same EvaluationResult contract.

This phase evaluates prompts only, it never edits code and never executes
changes.

## 1. New Dependencies

Add:

@google/generative-ai (Gemini fallback)

Do NOT add other dependencies unless explicitly asked.

Modal integration must be done using whatever Modal interface already exists
in your environment, or via a minimal HTTP bridge you implement in this repo.
Do not introduce complex infra.

## 2. Directory Structure (Strict)

Add:

src/server/greenlight/
  agent.ts
  tools.ts
  evaluate.ts
  conflict.ts
  backends/
    glm_modal.ts
    gemini.ts

No other folders.

## 3. Environment and Constants

Modal / GLM settings

OVERMIND_GREENLIGHT_BACKEND:

glm (default)

gemini (force fallback)

MODAL_GREENLIGHT_URL:

required when backend is glm

points to the Modal endpoint for evaluation, example:
https://<something>.modal.run/evaluate

MODAL_GREENLIGHT_TOKEN:

optional, if your endpoint needs auth

GLM_MODEL:

default glm-5.0

override via env

Gemini settings (fallback)

GEMINI_API_KEY optional unless backend forced to gemini

GEMINI_MODEL default gemini-2.0-flash, override via OVERMIND_MODEL

Add to src/shared/constants.ts

GREENLIGHT_BACKEND_DEFAULT = "glm"

GEMINI_MODEL, MAX_TOOL_ROUNDS, EVAL_TIMEOUT_MS

MAX_FILE_READ_LINES = 500

MAX_SEARCH_RESULTS = 50

LOG_TRUNCATE_CHARS = 200

No magic numbers.

## 4. Tooling Model

Important constraint:

Gemini supports tool calling, so it can directly request read_context and
fetch_code.

GLM on Modal is “offline” and must not directly access the filesystem.

So the tool model differs by backend:

For Gemini backend

Use tool calling loop exactly as defined previously (2 tools only).

For GLM backend

The Overmind server must do the file inspection locally, then send a compact
“context bundle” to the Modal evaluator.

That means:

The GLM backend does not call tools.

The Overmind server “precomputes” the tool outputs and sends them to the GLM
evaluator.

This keeps security and filesystem access local.

## 5. Context Bundle (Shared Input for GLM)

When using the GLM backend, send a structured request:

```
type GlmEvalRequest = {
  prompt: {
    promptId: string;
    content: string;
    scope?: string[];
  };
  concurrent: Array<{
    promptId: string;
    scope?: string[];
    contentSummary?: string; // optional, default omit
  }>;
  overlapHint: {
    overlaps: boolean;
    conflictPromptIds: string[];
    notes: string;
  };
  projectContext: {
    rootContext: string;              // context.md contents or not-found message
    relatedContextFiles: Array<{
      path: string;
      content: string;
    }>;
    codeSnippets: Array<{
      path: string;
      content: string;                // truncated
      note?: string;
    }>;
    fileListing?: string;             // optional, truncated
    searchResults?: string;           // optional, truncated
  };
  constraints: {
    mustNotLeakPromptContent: boolean;
    jsonOnly: boolean;
  };
};
```

Rules:

Truncate every string field to a reasonable size (use LOG_TRUNCATE_CHARS for
logs, but for model input allow larger, still cap it, for example 20k chars
total payload).

Never include other users’ full prompt content in concurrent list. Use scope
only by default.

Include the current prompt content, since it is being evaluated.

## 6. Tools Definition (Gemini Only, Exactly 2 Tools)

File: src/server/greenlight/tools.ts

Keep exactly these tools and handlers:

read_context

fetch_code

Same behavior as before:

never throw

always return a string

caps and skips for dist, .git, node_modules

These tools are used only by the Gemini backend.

## 7. Evaluation Contract (Same for Both)

evaluatePrompt() returns:

```
type EvaluationResult = {
  verdict: "greenlit" | "redlit";
  reasoning: string;         
  conflicts: string[];
  affectedFiles: string[];
  executionHints: {
    estimatedComplexity: "simple" | "moderate" | "complex";
    requiresBuild: boolean;
    requiresTests: boolean;
    relatedContextFiles: string[];
  };
};
```

Validate final results from both backends using Zod. If invalid, auto-greenlit.

## 8. Backend Implementations

src/server/greenlight/backends/gemini.ts

Implements multi-turn tool calling loop.

Uses exactly the 2 tools.

Bounded by MAX_TOOL_ROUNDS and EVAL_TIMEOUT_MS.

On failure, retry once, then auto-greenlit.

src/server/greenlight/backends/glm_modal.ts

Implements:

```
async function evaluateWithGlmModal(
  req: GlmEvalRequest,
  timeoutMs: number
): Promise<EvaluationResult>
```

Behavior:

POST JSON to MODAL_GREENLIGHT_URL with optional auth header if token exists.

The response body must be JSON for EvaluationResult.

Validate with Zod.

Timeout enforced, if exceeded auto-greenlit.

Fallback policy:

If backend is glm and Modal call fails, fallback to Gemini if API key exists.

If Gemini not available, auto-greenlit with “agent unavailable” reasoning.

## 9. GLM Modal Endpoint Contract

The Modal sandbox must run an evaluator service for GLM 5.0 that:

Accepts GlmEvalRequest

Produces only JSON EvaluationResult

Does not call tools

Uses the provided projectContext bundle to decide

Applies the same decision logic:

redlit only for genuine conflicts or architectural violations

otherwise greenlit

You do not implement the Modal service in this repo unless explicitly asked,
you only integrate with it via HTTP.

## 10. Decision Policy (Pinned)

Both backends must follow:

Greenlit if in doubt

Redlit only for:

architectural mismatch (rewrite language, big rewrites, violating constraints)

strong overlap with concurrent prompt scopes

unclear scope that likely touches broad areas

Reasoning must be 1 to 3 sentences.

## 11. Local Conflict Detection (Fast Hint)

detectScopeOverlap() stays local and runs before either backend.

If overlap is detected, include that in:

Gemini prompt

GLM request overlapHint

But the model is the final decider.

## 12. Server Integration (Sequential per Party)

Remove mock 2 second timer.

Evaluation must be sequential per party:

enqueue prompt

send prompt-queued

evaluator loop pops next prompt and evaluates using chosen backend

sends prompt-greenlit or prompt-redlit and appropriate activity

No races, no parallel evaluation per party.

Privacy rules unchanged:

Only host receives host-review-request with prompt content

Other members never see prompt content

## 13. Logging (Same Policy)

Write greenlight.log with:

timestamp

partyCode

promptId

backend used (glm or gemini)

tool calls (Gemini only)

Modal request summary (GLM only, no full prompt content)

truncation enforced

Never log full prompt text. Log:

promptId

prompt length

scope

backend results

## 14. Verification Checklist

Done only if:

With OVERMIND_GREENLIGHT_BACKEND=glm and MODAL_GREENLIGHT_URL set, prompts are
 evaluated via Modal GLM

If Modal is down and Gemini key set, it falls back to Gemini

If both unavailable, it auto-greenlits with clear reasoning

Normal prompt is greenlit

Overlapping scoped prompts tends to redlit one

“Rewrite in COBOL” is redlit

No prompt content leaks to non-host clients

greenlight.log shows backend choice and trace safely

Strict Phase Boundary

Do not:

implement the orchestrator

execute code changes

add more tools

add more UI

Phase 3 only evaluates and produces EvaluationResult.
