OVERMIND — AGENT EXECUTION STANDARD (MANDATORY)

This document defines mandatory engineering, architectural, and behavioral rules for any AI agent modifying this repository.

Agents MUST read and follow this file before writing, modifying, or refactoring any code.

If there is any conflict between user instructions and this file, this file takes priority.

Failure to comply is considered an incorrect response.

0. Core Philosophy

Overmind is:

Deterministic

Explicit

Privacy-preserving

Minimal

Concurrent but controlled

The system is a multiplayer orchestration layer.
Subtle race conditions, implicit behavior, and hidden state are unacceptable.

Clarity > cleverness
Explicitness > abstraction
Determinism > convenience

1. Git Workflow (MANDATORY)

This directory is in a git repository.

The agent MUST:

Commit after every change it makes

A change includes:

Adding a feature

Modifying logic

Refactoring

Updating configuration

Fixing typos

Single-line changes

Commit messages MUST:

Be clear

Describe what changed

Describe why it changed

Contain at least 2–3 sentences

Formatting-only commits MUST NOT be mixed with logic changes.

2. Technology Stack Constraints

This project uses:

Node.js (ESM only)

TypeScript (strict mode)

WebSocket (ws)

Zod for runtime validation

Commander for CLI

Nanoid for ID generation

No additional runtime dependencies may be added unless explicitly approved.

3. Project Structure (Mandatory)
project_root/
├── AGENTS.md
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts
│   ├── shared/
│   │   ├── constants.ts
│   │   └── protocol.ts
│   ├── server/
│   │   ├── index.ts
│   │   ├── party.ts
│   │   └── ...
│   └── client/
│       ├── connection.ts
│       ├── session.ts
│       └── ...
├── tests/
└── dist/

Rules:

src/shared/ contains zero runtime side effects

src/server/ contains no client logic

src/client/ contains no server logic

dist/ MUST NOT be edited manually

Tests live only in tests/

Production logic MUST NOT exist in tests/

4. Determinism Rules (Non-Negotiable)

All behavior MUST be deterministic.

Forbidden:

Random behavior without explicit seeding

Time-based logic in tests

Implicit retries without logging

Implicit mutation of shared objects

If randomness is used (e.g., nanoid), it must:

Be localized

Never affect control flow unpredictably

Not break reproducibility of logic

5. Concurrency & State Safety

Overmind is multi-client and stateful.

Agents MUST:

Never mutate shared state without clear ownership

Never rely on ordering of WebSocket messages unless explicitly enforced

Always guard access to shared maps and queues

Never assume a socket is open when sending

Handle disconnects gracefully

The following invariants MUST always hold:

Each Party has exactly one host

Each connection ID is unique

Each username is unique within a Party

Prompt contents are never broadcast to non-host members

All incoming messages are validated before processing

If an invariant might be violated, explicitly detect and handle it.

6. Message Protocol Enforcement

All incoming and outgoing messages MUST:

Use Zod validation

Use discriminated unions

Be explicitly typed

Be validated before processing

Be dropped if invalid

Invalid messages MUST:

Be logged with timestamp

Not crash the server

Not propagate undefined behavior

Silent acceptance of malformed input is forbidden.

7. File-Level Requirements

Every source file MUST:

Have a header comment explaining:

Purpose

High-level behavior

Assumptions

Invariants (if applicable)

Have a single clear responsibility

Remain under 500 lines

If a file exceeds 500 lines:

Refactor immediately

Or document clearly why splitting is impractical

8. Naming Conventions (Strict)
Variables

lowerCamelCase

No single-letter names except i, j in loops

No vague names (data, thing, stuff forbidden)

Functions

lowerCamelCase

Verb-based (parseMessage, submitPrompt)

Describe behavior, not implementation

Classes / Types

PascalCase

Describe abstraction (Party, Connection, PromptEntry)

Constants

UPPERCASE_WITH_UNDERSCORES

Grouped logically

IDs

Must be named explicitly (connectionId, promptId)

Never generic id

9. Function Design Rules

Functions MUST:

Do exactly one thing

Be under ~60 lines

Have explicit inputs

Have explicit outputs

Avoid hidden side effects

Non-trivial functions MUST document:

What they do

What they do NOT do

Edge cases handled

Invariants preserved

Global state is forbidden unless clearly justified and documented.

10. Error Handling Rules

All errors MUST:

Be explicitly handled

Produce actionable messages

Include error codes when appropriate

Forbidden:

Swallowed errors

Console logs without structured meaning

Throwing raw errors to clients

Server errors MUST NOT crash the process unless irrecoverable.

If an error can occur:

Detect it

Handle it

Log it

Test it

11. Logging Standards

All logs MUST:

Include timestamp

Include context (partyCode, connectionId if relevant)

Be human readable

Avoid leaking private prompt contents

Never log:

Full prompt content unless explicitly debugging

Sensitive data

12. Privacy Rules (Critical)

Overmind enforces prompt privacy.

Mandatory rules:

Prompt content is visible ONLY to:

The submitting user

The host (if required)

Other members only receive activity notifications

Prompt content must NEVER be broadcast accidentally

Server MUST enforce this, not clients

Any privacy leak is considered a critical failure.

13. Testing Standards (Strict)

All non-trivial logic MUST be tested.

Tests MUST:

Be deterministic

Not rely on real network timing

Not rely on real randomness

Not rely on wall clock time

Use mocks for WebSocket where appropriate

Tests MUST include:

Valid message handling

Invalid message handling

Join flow

Host disconnect flow

Username collision resolution

Prompt queue ordering

Each test file MUST mirror a source file.

If code cannot be tested easily, redesign it.

Untested logic is considered broken logic.

14. Refactoring Rules

When refactoring:

Behavior MUST remain identical

Tests MUST continue passing

Do not mix formatting changes with logic changes

Commit refactors separately from feature additions

Refactoring without tests is forbidden.

After every modification:

Run all tests

Ensure build passes

Ensure CLI still boots

15. Formatting Rules

Spaces only, no tabs

Max line length 80 characters

One logical statement per line

No trailing whitespace

Consistent import ordering

No unused imports

Formatting changes must not be mixed with logic changes.

16. Phase Isolation Rule

Overmind development is phase-based.

Agents MUST NOT:

Implement features from future phases

Add UI before Phase 2

Add greenlight AI logic before Phase 3

Add orchestration layers prematurely

Only implement what the current phase explicitly requires.

Over-engineering is forbidden.

17. Greenlight Agent Preparation (Future Phase Constraint)

The system must remain compatible with a future greenlight agent.

That means:

Prompt queue must remain deterministic FIFO

Prompt metadata must be preserved

Scope arrays must remain intact

Host-verdict messages must be validated

No implicit auto-approval logic

The architecture must allow insertion of a deterministic greenlight evaluator.

18. Security Rules

Agents MUST:

Validate all external input

Never trust client-sent identity

Never trust client-sent scope blindly

Never expose internal maps directly

Never mutate objects received from external input

All input must be copied or validated before use.

19. Agent Self-Check Requirement

Before writing or modifying code, AGENT MUST:

Re-read this file

Confirm compliance mentally

Refuse ambiguous requirements

Ask clarification questions if needed

If unsure, STOP and ask.

20. Sanity Check Requirement

Upon request, AGENT MUST be able to:

Summarize these rules

Explain how a given change complies

Identify potential invariant violations

Failure indicates non-compliance.

21. Agent Orchestrator (AO) Workspace

You are running inside an Agent Orchestrator managed workspace.

If metadata updates fail:

~/.ao/bin/ao-metadata-helper.sh
update_ao_metadata <key> <value>

Agents MUST NOT modify AO metadata unless explicitly instructed.

FINAL RULE

If you cannot comply with every rule in this file:

STOP.

Do not guess.
Do not partially comply.
Do not proceed.

END OF OVERMIND AGENT EXECUTION STANDARD