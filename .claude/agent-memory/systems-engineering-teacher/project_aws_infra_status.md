---
name: overmind-aws-infra-status
description: Overmind AWS infrastructure build status as of 2026-03-14; what is deployed, what is scripted but not deployed, what is missing
type: project
---

Overmind is transitioning its remote execution backend from Modal to AWS. Current live backend is still Modal (OVERMIND_ORCHESTRATOR_URL points to modal.run). AWS backend is work-in-progress.

**Why:** Student is building AWS as the production-grade replacement for Modal, with SageMaker for LLM inference and ECS Fargate for the orchestrator.

**Key architectural fact:** The orchestrator (modal/orchestrator.py) currently runs workers in-process via asyncio.create_task. The TODO comment at line 465 explicitly says to replace this with ECS Fargate task dispatch for production. The Dockerfile (modal/.dockerfile) exists and is ready to containerize the orchestrator.

**What is deployed/live on AWS:**
- Nothing. No AWS resources are confirmed deployed. Modal is still the active backend.

**What is scripted but NOT yet deployed:**
1. SageMaker endpoint (deploy/scripts/deploy_sagemeker.py + deploy_sagemaker.sh)
   - Target: Qwen3.5-35B-A3B on ml.g5.12xlarge, HuggingFace TGI container
   - Blocker: GPU quota for ml.g5.12xlarge is 0 by default; Service Quotas increase pending (1-5 business days)
2. Cost protection pipeline (deploy/lambda-endpoint-killer/setup.sh)
   - Lambda that auto-deletes SageMaker endpoints when $50 CloudWatch billing alarm fires
   - setup.sh not run yet; nothing deployed

**What has NOT been started (missing infrastructure):**
- ECR repository (needed to push the orchestrator Docker image)
- ECS Fargate cluster + task definition + service (the orchestrator container runtime)
- Application Load Balancer or API Gateway (to expose /runs and /health publicly)
- DynamoDB table (run_store.py has "dynamodb" backend stub but it raises ValueError if selected; memory backend is all that works)
- VPC/networking config for Fargate (needs subnets, security groups)
- IAM role for ECS task execution
- SageMaker execution role (needed before running the deploy script)

**Current .env state (as of 2026-03-14):**
- RUN_BACKEND_STORE="aws-fargate" — set but the code doesn't support this yet
- OVERMIND_GPU_BACKEND=aws — set but SageMaker not deployed
- OVERMIND_LOCAL=1 — still set, so actual execution goes local Gemini, not Modal or AWS
- OVERMIND_ORCHESTRATOR_URL points to Modal (still live fallback)
- OPENAI_API_KEY is "sk-dummy" — no real OpenAI key

**Critical path order:**
1. Deploy cost protection Lambda FIRST (before spending any money on GPU instances)
2. Request SageMaker GPU quota increase if not already done (1-5 business day wait)
3. Create ECR repo + push orchestrator Docker image
4. Create VPC/networking for Fargate
5. Deploy ECS Fargate cluster + service (orchestrator)
6. Deploy ALB or API Gateway in front of Fargate
7. Deploy SageMaker endpoint (once quota approved) — point OVERMIND_LLM_URL at it
8. Implement DynamoDB backend in run_store.py (swap out memory store)
9. Update .env: set OVERMIND_ORCHESTRATOR_URL to ALB/API Gateway URL, remove OVERMIND_LOCAL=1

**How to apply:** When helping with any next step, check this ordering. Never suggest deploying the SageMaker GPU endpoint before the billing alarm is live. Always remind about the quota wait time.
