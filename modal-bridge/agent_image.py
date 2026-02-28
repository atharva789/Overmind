"""
Purpose: Define Modal images used for coding agents.
High-level behavior: Exposes base and build images for sandboxes.
Assumptions: Modal SDK is configured and available.
Invariants: Image names are stable and fall back to base.
"""

import modal

AGENT_BASE_IMAGE = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "ripgrep", "jq")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g @anthropic-ai/claude-code",
    )
    .pip_install("modal")
)

AGENT_BUILD_IMAGE = AGENT_BASE_IMAGE.run_commands(
    "npm install -g typescript tsx",
    "apt-get install -y build-essential",
)

IMAGE_REGISTRY: dict[str, modal.Image] = {
    "base": AGENT_BASE_IMAGE,
    "build": AGENT_BUILD_IMAGE,
}


def get_or_build_image(image_name: str) -> modal.Image:
    """
    Resolve an image name to a Modal Image.
    Does not build custom images beyond the registry.
    Edge case: Unknown names fall back to the base image.
    """
    return IMAGE_REGISTRY.get(image_name, AGENT_BASE_IMAGE)
