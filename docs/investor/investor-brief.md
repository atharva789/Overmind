# Overmind — Comprehensive Investor Brief

## Executive Summary

Overmind is the first multiplayer AI coding terminal — a shared execution environment where entire engineering teams submit prompts to one AI pipeline. While every AI coding tool on the market operates in single-player mode (Copilot, Cursor, Devin), Overmind introduces real-time collaboration with deterministic execution ordering, AI-powered merge conflict resolution, and end-to-end observability.

The product is functional and deployed on AWS. This document provides the technical and market context for a pre-seed investment.

---

## 1. Market Analysis

### The Developer Tools Landscape

The developer tools market reached **$45B in 2024** and is projected to exceed **$65B by 2028** (Gartner). AI-assisted development is the fastest-growing segment:

- **GitHub Copilot**: $2B+ ARR, 1.8M paid subscribers (Microsoft Q4 2024)
- **Cursor**: Raised at $2.5B valuation (Thrive Capital, 2024)
- **Devin (Cognition)**: Raised at $2B valuation (Founders Fund, 2024)
- **Codeium / Tabnine / Sourcegraph Cody**: Combined $500M+ in funding

Every one of these tools operates in **single-player mode**. There is no coordination layer for teams.

### The Multiplayer Gap

Figma disrupted design by making it real-time multiplayer — capturing a **$20B valuation** (Adobe acquisition attempt, 2022). Google Docs disrupted documents the same way. The pattern is clear: **single-player tools lose to multiplayer alternatives when collaboration matters**.

In software development, collaboration matters more than in any other creative discipline:
- Average team size: 5-8 engineers per product
- Average AI tool adoption: 70%+ of engineers at tech companies (GitHub 2024 survey)
- Result: 5+ independent AI agents operating on the same codebase with zero coordination

The cost of uncoordinated AI coding is measurable:
- **Duplicate work**: Multiple agents implementing similar changes independently
- **Merge conflicts**: AI-generated code conflicts at 3-5x the rate of human code (longer diffs, more files touched per change)
- **Context loss**: Each agent operates in isolation, unaware of concurrent changes
- **Audit gap**: No unified log of what AI changed, when, and why

### Addressable Market

| Segment | Calculation | Size |
|---|---|---|
| **TAM** | Global developer tools spending | $45B |
| **SAM** | AI-assisted development (15% of TAM, growing 40% YoY) | $15B |
| **SOM** | Teams with 3+ devs using AI tools × $29-99/seat/mo | $2.4B |

---

## 2. Product

### What Overmind Does

A host runs `overmind host` in their project directory. Teammates join with a 4-letter party code from any terminal. They submit natural language prompts. Each prompt flows through a 7-stage pipeline:

1. **FIFO Queue** — Deterministic ordering prevents race conditions
2. **Scope Extraction** — Gemini AI identifies which files (max 15) will be affected
3. **Greenlight** — AI safety check evaluates the prompt for destructive operations
4. **Host Approval** — Human-in-the-loop gate; the host sees the scope and decides
5. **Multi-Agent Execution** — A planner decomposes the task into subtasks; parallel subagents execute with sandboxed tools (read_file, write_file, list_dir); an evaluation agent reviews all changes
6. **AI Merge Resolution** — Three-way diff with confidence scoring; low-confidence merges flagged for human review
7. **PR Creation** — Commits to a branch, opens a GitHub PR with AI-generated description

### Key Properties

| Property | Implementation |
|---|---|
| **Privacy** | Prompt content visible only to submitter + host; never broadcast |
| **Safety** | Scope-bounded (15 files max), greenlight check, host approval gate |
| **Observability** | Langfuse traces with nested spans, token metrics, cost tracking |
| **Determinism** | FIFO queue + serial execution prevents ordering ambiguity |
| **Streaming** | 8 event types flow real-time from orchestrator to TUI via WebSocket |
| **Resilience** | Graceful disconnect handling (30s timeout), no-throw merge pipeline |

### Execution Backends

| Mode | Engine | Use Case |
|---|---|---|
| **Local** | Gemini 2.0 Flash tool-calling loop (25 rounds max, 120s timeout) | Development, low-latency, single machine |
| **Remote** | Python FastAPI on ECS Fargate with GPT-4o planner + parallel subagents | Production, complex tasks, team deployment |

---

## 3. Technical Architecture

### Stack

| Layer | Technology |
|---|---|
| CLI + TUI | TypeScript, Commander.js, Ink (React for terminal) |
| Protocol | 20+ Zod discriminated union message types, WebSocket |
| Server | Node.js, WebSocket, FIFO queue, event dispatch |
| Local Execution | Gemini 2.0 Flash, tool-calling loop, scoped file access |
| Remote Orchestrator | Python FastAPI, GPT-4o, parallel subagents, async evaluation |
| Infrastructure | AWS ECS Fargate, ALB, ECR, SSM Parameter Store, CloudWatch |
| Database | PostgreSQL + pgvector (story clustering, semantic code search) |
| Observability | Langfuse (hierarchical traces, spans, token metrics per execution) |
| CI/CD | GitHub Actions → ECR → ECS (auto-deploy on push) |
| IaC | Terraform (VPC, ECS, ALB, security groups, SSM, CloudWatch) |

### Protocol Design

Every WebSocket message is validated against a Zod discriminated union before processing. Invalid messages are logged and dropped — never propagated. This provides:
- Compile-time type safety across client and server
- Runtime validation at the wire boundary
- Self-documenting protocol (schema is the spec)

### Observability Architecture

```
Root Trace (run_id, session_id, tags)
├── Planning Span (query_length → task_count)
├── Subagent Span (task_index, task_name)
│   ├── LLM Generation (auto-captured: tokens, latency, cost)
│   ├── Tool Use Events
│   └── Agent Thinking Events
├── Subagent Span (task_index, task_name)
│   └── ...
└── Evaluation Span (decision: finish | draft-plan)
```

---

## 4. Competition

### Detailed Comparison

| Dimension | GitHub Copilot | Cursor | Devin | **Overmind** |
|---|---|---|---|---|
| **Model** | Autocomplete + chat | IDE-integrated AI | Autonomous agent | Multiplayer terminal pipeline |
| **Multiplayer** | None | None | None | Up to 8 concurrent developers |
| **Execution safety** | None (runs in editor) | None | Minimal | 3-layer: scope + greenlight + host approval |
| **Merge handling** | None | None | None | AI three-way resolution with confidence scoring |
| **Observability** | None | None | Task logs | Langfuse traces with token/cost metrics |
| **Deployment** | Cloud only | Cloud only | Cloud only | Self-hosted or managed (ECS Fargate) |
| **Protocol** | Proprietary | Proprietary | Proprietary | Open, Zod-validated, documented |
| **Streaming** | Token-level | Token-level | Task status | 8 semantic event types (plan, tool, thinking) |
| **Feature memory** | None | None | Session-scoped | pgvector clustering across sessions |
| **Pricing** | $19/seat | $20/seat | $500/mo | Free (self-hosted) / $29-99/seat (managed) |

### Moat

1. **Protocol + execution pipeline**: The 7-stage pipeline with type-safe protocol is hard to bolt onto existing single-player tools
2. **Merge resolution**: AI merge with confidence scoring requires deep integration with the execution layer — it's not a feature you add later
3. **Observability**: Langfuse integration across the full pipeline provides debugging capabilities that competitors lack entirely
4. **Open protocol**: Zod schemas enable third-party client development, building an ecosystem

---

## 5. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| GitHub builds multiplayer into Copilot | High | First-mover advantage; our pipeline architecture is fundamentally different from autocomplete. Open-source community building. |
| LLM quality degrades for coding tasks | Medium | Model-agnostic architecture — swap Gemini/GPT-4o for any provider. Local execution mode works with any API-compatible model. |
| Enterprise resistance to AI code execution | Medium | Host approval gate + scope bounding + Langfuse audit trail address compliance concerns directly. |
| Scaling WebSocket sessions | Low | Architecture already supports remote execution offloading. Session state is per-party, horizontally scalable. |
| Single-founder risk | Medium | Modular codebase with clear layer separation enables rapid onboarding. Seeking co-founder with GTM experience. |

---

## 6. Go-to-Market Strategy

### Phase 1: Developer Adoption (Months 1-6)
- Open-source self-hosted version (free forever)
- Developer content: blog posts, demo videos, conference talks
- Target: open-source projects, hackathon teams, bootcamp cohorts
- Goal: 500 GitHub stars, 50 active teams

### Phase 2: Team Product (Months 6-12)
- Launch managed cloud orchestrator ($29/seat/mo)
- Team dashboard: session history, cost tracking, usage analytics
- Slack/Discord integration for session notifications
- Goal: 200 paying seats, $5.8K MRR

### Phase 3: Enterprise (Months 12-18)
- SSO (SAML/OIDC), audit logs, role-based access
- On-premise deployment option
- Dedicated infrastructure, SLA
- SOC 2 Type II compliance
- Goal: 3 enterprise contracts, $50K+ ARR each

---

## 7. Milestones Achieved

- End-to-end multiplayer AI coding pipeline: submit → scope → greenlight → approve → execute → merge → PR
- Dual execution backends: local Gemini agent + remote ECS Fargate orchestrator
- Production AWS deployment: ECS, ALB, ECR, CloudWatch, SSM, Terraform IaC
- CI/CD: GitHub Actions → ECR → ECS auto-deploy
- Real-time streaming: 8 event types from orchestrator to TUI via WebSocket
- Langfuse observability: hierarchical traces with token metrics across full pipeline
- Feature clustering: PostgreSQL + pgvector semantic grouping with STORY.md generation
- Type-safe protocol: 20+ Zod-validated WebSocket message types
- Privacy invariant: prompt content isolated to submitter + host

---

## 8. Financial Ask

**Raising: $500K pre-seed**

| Use of Funds | Allocation |
|---|---|
| Engineering (2 hires: backend + infra) | 60% ($300K) |
| Cloud infrastructure (AWS, LLM API costs) | 20% ($100K) |
| Go-to-market (content, events, community) | 15% ($75K) |
| Legal + ops | 5% ($25K) |

**Runway:** 12-14 months at current burn projection

**Key milestones with funding:**
1. **Month 3**: Managed cloud orchestrator live, 50 beta teams
2. **Month 6**: Team dashboard, 200 paying seats
3. **Month 9**: Enterprise features (SSO, audit), first enterprise pilot
4. **Month 12**: Seed-ready metrics ($100K+ ARR, 3+ enterprise contracts)

---

*Overmind: where your entire team ships through one AI pipeline — in real time.*
