---
name: overmind-llm-deployment
description: Overmind project is evaluating LLM deployment options for its AI coding tool backend; considering SageMaker, Bedrock, and non-AWS alternatives
type: project
---

Overmind currently uses Gemini for local execution and Modal for remote execution. Student is exploring deploying Qwen3.5-35B-A3B as an additional/alternative backend.

**Why:** The project needs an LLM inference backend for its multiplayer AI coding terminal.

**How to apply:** When discussing deployment options, remember the project already has a Modal orchestrator (modal/orchestrator.py) and local Gemini agent (src/server/execution/agent.ts). Any new LLM deployment needs to integrate with this existing architecture. Cost sensitivity is high -- this is not an enterprise budget.
