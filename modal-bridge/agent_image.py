"""
agent_image.py — Pre-built Modal Image definitions for coding agents.

Purpose:
  Defines reusable Modal Images that sandboxes are spawned from.
  Images are built/cached by Modal on first use and reused thereafter.

Assumptions:
  - Agents primarily need Node.js 22, git, and Claude Code CLI.
  - The "build" image additionally installs TypeScript + build-essential.

Invariants:
  - Image names are stable strings ("base", "build").
  - Unknown image names fall back to the base image.
"""

import modal

# Base image for coding agents — has Node, Python, git, common tools
agent_base_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "ripgrep", "jq")
    .run_commands(
        # Install Node.js 22
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        # Install Claude Code CLI (default agent)
        "npm install -g @anthropic-ai/claude-code",
    )
    .pip_install("modal")
)

# Heavier image with build tools for prompts that need compilation
agent_build_image = agent_base_image.run_commands(
    "npm install -g typescript tsx",
    "apt-get install -y build-essential",
)

# Registry of available images
_IMAGE_REGISTRY: dict[str, modal.Image] = {
    "base": agent_base_image,
    "build": agent_build_image,
}


def get_or_build_image(image_name: str) -> modal.Image:
    """
    Resolve an image name to a Modal Image.

    Returns the base image for unrecognized names.
    Does NOT build custom images at runtime — only returns
    pre-defined images from the registry.
    """
    return _IMAGE_REGISTRY.get(image_name, agent_base_image)
