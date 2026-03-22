Major update to Overmind -- the multiplayer AI coding agent I've been building.

Two big changes this week:

1. Production infrastructure on AWS

For Overmind to work as a real coding agent and not a hackathon demo, it needs to run reliably, deploy automatically, and handle secrets properly. That meant standing up actual infrastructure:
- ECS Fargate orchestrator behind an ALB — stable endpoint, no IP juggling between deploys
- Multi-stage Docker builds with non-root containers for a lean, secure runtime
- Secrets injected at boot via SSM Parameter Store — zero hardcoded credentials
- CI/CD through GitHub Actions: every push to `modal/` rebuilds and pushes to ECR with commit-tagged images
- Budget alerts and a one-command kill switch to keep costs predictable

All of it is Terraform-managed — cluster, service, ALB, security groups, target groups, CloudWatch logging. Infrastructure drifts and ClickOps aren't an option when the agent itself depends on this stack being correct.

2. Real-time multi-agent streaming

The orchestrator now decomposes prompts into parallel tasks using a planner agent, then spawns independent subagents that execute concurrently. The interesting part: every event streams back to the terminal UI in real-time over WebSocket.

You can see exactly what each agent is doing -- which tool it's calling, whether it succeeded, and a preview of the output -- as it happens. No more waiting for a black box to finish.

The architecture:
- Python orchestrator emits events into a per-run asyncio queue
- WebSocket endpoint drains the queue to the TypeScript server
- Server forwards events to the submitter's terminal (privacy-preserving: other team members don't see your prompt details)
- Ink/React TUI renders a multi-agent panel with per-task status

Stack: TypeScript, Python, FastAPI, ECS Fargate, Terraform, OpenAI, pgvector, WebSocket

Building in public: github.com/atharva789/Overmind

#SoftwareEngineering #CloudComputing #AWS #AI #OpenSource #Terraform
