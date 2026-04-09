# Overmind — Investor One-Pager

## The Problem

Every AI coding tool on the market — GitHub Copilot ($2B+ ARR), Cursor ($2.5B valuation), Devin ($2B valuation) — is single-player. When multiple engineers on the same team each use their own AI assistant, the result is duplicated work, conflicting changes, and hours spent manually resolving AI-generated merge conflicts. There is no shared context, no coordination layer, and no multiplayer mode for AI-assisted development.

## The Solution

**Overmind** is the first multiplayer AI coding terminal. A host opens a session in their project directory; teammates join from anywhere with a 4-letter party code. Every prompt flows through a deterministic, auditable pipeline:

**Scope Extraction** (AI identifies affected files, max 15) → **Greenlight** (AI safety check) → **Host Approval** (human-in-the-loop) → **Multi-Agent Execution** (planner decomposes into parallel subagents) → **AI Merge Resolution** (three-way diff with confidence scoring) → **PR Creation** (auto-generated)

No IDE plugins. No cloud lock-in. Self-hostable. One CLI, and your team is shipping through one AI pipeline.

## Market

| Segment | Size |
|---|---|
| **TAM** — Global developer tools market | $45B (2025) |
| **SAM** — AI-assisted development tools | $15B (growing 40% YoY) |
| **SOM** — Teams with 3+ developers using AI coding tools | $2.4B |

The same market dynamic that drove Figma to a $20B valuation in design — real-time multiplayer replacing single-player tools — is emerging in AI-assisted coding.

## Differentiation

| | Copilot | Cursor | Devin | **Overmind** |
|---|:---:|:---:|:---:|:---:|
| Real-time multiplayer | - | - | - | **Yes (8 devs)** |
| AI merge resolution | - | - | - | **Yes** |
| Human-in-the-loop approval | - | - | - | **Yes** |
| Scope-bounded execution | - | - | - | **Yes (15 files)** |
| LLM observability | - | - | - | **Yes (Langfuse)** |
| Self-hostable | - | - | - | **Yes** |

## Architecture

Production-grade infrastructure:
- **TypeScript WebSocket server** with 20+ Zod-validated message types
- **Ink/React TUI** with real-time streaming (8 event types)
- **Python FastAPI orchestrator** on AWS ECS Fargate (planner → parallel subagents → evaluation)
- **PostgreSQL + pgvector** for semantic feature clustering
- **Langfuse** end-to-end LLM observability (traces, spans, token metrics)
- **Terraform IaC** + GitHub Actions CI/CD → ECR → ECS

## Business Model

**Open-core SaaS:**
- **Free tier** — Self-hosted, unlimited local execution
- **Team ($29/seat/mo)** — Managed cloud orchestrator, priority execution, dashboard
- **Enterprise ($99/seat/mo)** — SSO, audit logs, dedicated infrastructure, SLA, on-prem deployment

## Traction

- Functional end-to-end product: multiplayer sessions, dual execution backends (local + ECS), merge resolution, PR creation
- Production AWS deployment (ECS Fargate, ALB, ECR, CloudWatch, Terraform)
- CI/CD pipeline: GitHub Actions → ECR → ECS auto-deploy
- Langfuse observability integrated across full execution pipeline
- Real-time streaming from orchestrator to TUI (WebSocket)

## Team

**Atharva** — Builder. Full-stack implementation of multiplayer AI infrastructure spanning TypeScript, Python, AWS, and Terraform. Designed the execution pipeline, protocol layer, merge system, and observability stack.

## The Ask

**$500K pre-seed** to:
1. Launch hosted cloud orchestrator (managed execution backend)
2. Build team dashboard (session history, observability, cost tracking)
3. Acquire first 50 teams for design partnership program
4. Hire 1 backend engineer (execution pipeline) + 1 infra engineer (scaling)

---

*Overmind: where your entire team ships through one AI pipeline — in real time.*
