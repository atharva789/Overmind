# Overmind

Multiplayer AI coding agent for your terminal. A host opens a session in their project; teammates join from anywhere and submit prompts; an AI agent executes the changes live in the host's directory.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Architecture                                    │
│                                                                           │
│  Teammate A ──┐                                                           │
│  Teammate B ──┼──► WebSocket Party ──► Story Agent                       │
│  Teammate C ──┘         │              (clusters prompts)                 │
│                         │                                                 │
│                         ▼                                                 │
│                   Scope Extractor                                         │
│                   (Gemini: which files?)                                  │
│                         │                                                 │
│              ┌──────────┴──────────┐                                     │
│              ▼                     ▼                                      │
│        Local Agent          ECS Orchestrator (Fargate)                    │
│        (OVERMIND_LOCAL=1)         │                                       │
│              │                    ▼                                       │
│              │             Planner Agent (gpt-4o)                         │
│              │                    │                                       │
│              │         ┌──────┬──┴──┬──────┐                             │
│              │         ▼      ▼     ▼      ▼                             │
│              │       Sub-   Sub-  Sub-   Sub-                            │
│              │       agent  agent agent  agent                           │
│              │         │      │     │      │                             │
│              │         └──────┴──┬──┴──────┘                             │
│              │                   │  (tool-use streamed via WebSocket)     │
│              └──────────┬────────┘                                       │
│                         ▼                                                 │
│                  Host's Project Files                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Real-Time Streaming

The orchestrator streams execution events to the frontend in real-time over WebSocket:

```
Orchestrator (Python)              Server (TypeScript)              Client (TUI)
agent_loop emits events
  → Session asyncio.Queue  ──WS──>  handleExecutionEvent    ──WS──>  ExecutionView
                                     (submitter only)                 multi-agent panel
```

Events streamed:
- **plan-ready** — planner decomposes prompt into named tasks
- **agent-spawned** — each subagent starts with a task name
- **tool-use / tool-result** — tool name, success/failure, truncated output
- **agent-finished** — per-agent completion with files changed
- **run-complete / run-error** — terminal events close the WebSocket

## AWS Infrastructure

The remote execution backend runs on AWS and is fully managed with Terraform (`infra/`).

```
Internet
   │
   ▼
Application Load Balancer (overmind-alb)
   │  HTTP :80
   ▼
Target Group (overmind-tg, port 8000)
   │
   ▼
ECS Fargate Task (overmind-container)
   │  FastAPI + uvicorn, port 8000
   ├── Secrets via SSM Parameter Store
   │   ├── OPENAI_API_KEY
   │   ├── GEMINI_API_KEY
   │   ├── MODEL_ID
   │   ├── OVERMIND_DATABASE_URL
   │   ├── OVERMIND_EMBEDDING_MODEL
   │   └── OVERMIND_EMBEDDING_DIMS
   └── Logs → CloudWatch (/ecs/overmind)

Supporting services:
  ECR  — Docker image registry (overmind-orchestrator-repo)
  VPC  — Default VPC, 3 subnets across availability zones
```

### Terraform-managed resources

| Resource | Name |
|----------|------|
| ECS Cluster | `overmind-ecs-cluster` |
| ECS Service | `overmind-orchestrator` |
| Application Load Balancer | `overmind-alb` |
| ALB Target Group | `overmind-tg` |
| CloudWatch Log Group | `/ecs/overmind` |
| Security Group (ECS tasks) | `overmind-ecs-sg` |
| Security Group (ALB) | `overmind-alb-sg` |

### CI/CD

GitHub Actions (`.github/workflows/workflow.yml`) triggers on push to `thorba-iterate` or any `v*` tag:
1. Authenticates to ECR
2. Builds Docker image (`modal/.dockerfile`) with `--platform linux/amd64`
3. Tags as `sha-<short-sha>` or `v<tag>` and pushes to ECR
4. ECS picks up the new image on next forced deployment

---

## Setup

Requires Node.js 20+.

```bash
npm install -g github:atharva789/Overmind
```

Or clone and install locally:
```bash
git clone git@github.com:atharva789/Overmind.git
cd Overmind && npm install && npm link
```

Set your API key:
```bash
export GEMINI_API_KEY="your-key"
```

## Host a Session

Navigate to your project and start:
```bash
overmind host --port 4444
```

This prints a 4-letter party code (e.g. `ABCD`). Share it with teammates.

**To expose over the internet via ngrok:**
```bash
ngrok tcp 4444
# Share the ngrok host, port, and party code
```

## Join a Session

```bash
# Over the internet (ngrok)
overmind join ABCD --server 4.tcp.ngrok.io --port 14680 -u "YourName"

# Local network
overmind join ABCD --server 192.168.1.50 --port 4444 -u "YourName"
```

## Execution Modes

| Mode | Config | Description |
|------|--------|-------------|
| Local | `OVERMIND_LOCAL=1` | Runs Gemini agent directly on host machine |
| Remote | `OVERMIND_ORCHESTRATOR_URL=...` | Executes in ECS Fargate via ALB |

For local mode, add to `.env`:
```
OVERMIND_LOCAL=1
GEMINI_API_KEY=your-key
```

For remote mode, point at the ALB:
```
OVERMIND_ORCHESTRATOR_URL=http://overmind-alb-1995529200.us-east-2.elb.amazonaws.com
```

### Infrastructure commands

```bash
# Bring up / update infrastructure
cd infra && terraform apply

# Kill all running tasks (preserves infrastructure, stops billing for compute)
bash infra/kill.sh

# Restart
aws ecs update-service --cluster overmind-ecs-cluster --service overmind-orchestrator --desired-count 1 --region us-east-2
```

---

## Upcoming changes

### Agent architecture
- **Persistent agent memory** — store per-session and per-project context in PostgreSQL (pgvector) so agents can reference prior changes
- **Agent evaluation harness** — recall@k and precision@k metrics for scope extraction and semantic search

### Infrastructure
- **HTTPS / custom domain** — ACM certificate + Route 53 alias record on the ALB
- **Remote Terraform state** — migrate `terraform.tfstate` to S3 + DynamoDB locking for team use
- **Auto-scaling** — ECS service auto-scaling based on ALB request count
- **API authentication** — API key middleware on orchestrator endpoints

---

## Feedback

We'd love to hear from you! Please share your experience, report bugs, or suggest improvements using our feedback form:

**[Overmind Feedback Form](https://docs.google.com/forms/d/e/1FAIpQLSfbYdIqiNQT3KLJZRsKJojx6VJsrhSQloBVfRzn61H6nnCuxw/viewform)**
