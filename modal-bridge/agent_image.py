"""
Purpose: Define Modal images used for coding agents.
High-level behavior: Provides base and build images for sandboxes.
Assumptions: Modal SDK is configured and available.
Invariants: Image keys remain stable across versions.
"""

import modal


def build_base_image() -> modal.Image:
    """
    Build the base image used for most coding tasks.
    Does not include heavy build toolchains.
    """
    return (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("git", "curl", "ripgrep", "jq")
        .run_commands(
            "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
            "apt-get install -y nodejs",
            "npm install -g @anthropic-ai/claude-code",
        )
        .pip_install("modal")
    )


def build_image_with_tools(base_image: modal.Image) -> modal.Image:
    """
    Extend the base image with build tools for heavier prompts.
    Does not modify the base image in place.
    """
    return base_image.run_commands(
        "npm install -g typescript tsx",
        "apt-get install -y build-essential",
    )


def get_or_build_image(image_name: str) -> modal.Image:
    """
    Return an image by name, defaulting to the base image.
    Supported names: base, build.
    """
    base_image = build_base_image()
    build_image = build_image_with_tools(base_image)

    images: dict[str, modal.Image] = {
        "base": base_image,
        "build": build_image,
    }

    return images.get(image_name, base_image)
