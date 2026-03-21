import os
from pydantic import BaseModel, Field

class PlannerTask(BaseModel):
    agent_name: str = Field(description="subagent name")
    task_description: str = Field(description="subagent task summary")
    system_prompt: str = Field(description="The system prompt for the subagent")
    user_prompt: str = Field(description="The user prompt for the subagent")

class PlannerOutput(BaseModel):
    tasks: list[PlannerTask] = Field(description="An array of independent tasks")

