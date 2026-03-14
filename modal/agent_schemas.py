import os
from pydantic import BaseModel, Field

# 1. Define your schemas using Pydantic
class PlannerTask(BaseModel):
    system_prompt: str = Field(description="The system prompt for the subagent")
    user_prompt: str = Field(description="The user prompt for the subagent")

class PlannerOutput(BaseModel):
    tasks: list[PlannerTask] = Field(description="An array of independent tasks")

