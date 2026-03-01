/**
 * Purpose: Open a GitHub PR for the resolved branch with a full description
 *   documenting every resolution decision made by the LLM.
 * High-level behavior: POSTs to the GitHub REST API to create a pull
 *   request from the resolution branch into the configured base branch.
 * Assumptions: GITHUB_TOKEN and GITHUB_REPO env vars are set.
 * Invariants: PR description uses markdown and is human-readable.
 *   No prompt content is included in any PR field.
 */

import { appendFileSync } from "fs";
import type { FileResolution } from "./types.js";

const LOG_PATH = "orchestrator.log";

function log(msg: string): void {
    const line = `[${new Date().toISOString()}] [MERGE-GITHUB] ${msg}\n`;
    process.stdout.write(line);
    try {
        appendFileSync(LOG_PATH, line);
    } catch {
        // Log failures must not crash PR creation.
    }
}

/**
 * Open a GitHub PR for the resolved branch.
 * Returns the PR URL on success.
 * Throws with a clear message if required env vars are missing.
 */
export async function openPullRequest(
    branchName: string,
    title: string,
    description: string
): Promise<string> {
    const token = process.env["GITHUB_TOKEN"];
    const repo = process.env["GITHUB_REPO"];
    const base = process.env["GITHUB_BASE_BRANCH"] ?? "main";

    if (!token) {
        throw new Error(
            "GITHUB_TOKEN environment variable is required"
        );
    }
    if (!repo) {
        throw new Error(
            "GITHUB_REPO environment variable is required " +
            "(format: owner/repo)"
        );
    }

    const response = await fetch(
        `https://api.github.com/repos/${repo}/pulls`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
                title,
                body: description,
                head: branchName,
                base,
            }),
        }
    );

    if (!response.ok) {
        const err = await response.text();
        throw new Error(
            `GitHub API error ${response.status}: ${err}`
        );
    }

    const data = await response.json() as { html_url: string };
    log(`PR opened: ${data.html_url}`);
    return data.html_url;
}

/**
 * Generate the PR title.
 * Prepends a warning emoji if any resolution has low confidence.
 */
export function generatePrTitle(
    partyCode: string,
    hasLowConfidence: boolean
): string {
    const prefix = hasLowConfidence ? "⚠️ " : "";
    return (
        `${prefix}[Overmind] Merge conflicts resolved` +
        ` — Party ${partyCode}`
    );
}

/**
 * Generate the full PR description in markdown.
 * Documents every resolution decision with reasoning and confidence.
 * Does not include prompt content.
 */
export function generatePrDescription(
    partyCode: string,
    storyMd: string,
    resolutions: FileResolution[],
    branchName: string
): string {
    const icon = (c: FileResolution["confidence"]): string =>
        c === "high" ? "✅" : c === "medium" ? "⚠️" : "❌";

    const lowConfFiles = resolutions.filter((r) => r.confidence === "low");
    const storyExcerpt =
        storyMd.slice(0, 500) +
        (storyMd.length > 500 ? "\n\n*(truncated)*" : "");

    const resolutionSections = resolutions
        .map(
            (r) =>
                `\n### \`${r.path}\`\n` +
                `**Confidence:** ${icon(r.confidence)} ${r.confidence}\n` +
                `**Reasoning:** ${r.reasoning}\n` +
                (r.issues.length > 0
                    ? `**Issues:** ${r.issues.join(", ")}`
                    : "**Issues:** None")
        )
        .join("\n\n---\n");

    const lowConfSection =
        lowConfFiles.length === 0
            ? ""
            : `\n\n---\n\n` +
              `## ❌ Low Confidence Resolutions — Review These Carefully\n\n` +
              lowConfFiles
                  .map((r) => `- \`${r.path}\`: ${r.reasoning}`)
                  .join("\n");

    return (
        `## Overmind Merge Conflict Resolution\n\n` +
        `**Party:** ${partyCode}\n` +
        `**Files resolved:** ${resolutions.length}\n` +
        `**Model:** Qwen3-4B via Modal vLLM inference\n\n` +
        `---\n\n` +
        `## What Was Being Built\n\n` +
        `${storyExcerpt}\n\n` +
        `---\n\n` +
        `## Conflict Resolutions\n` +
        `${resolutionSections}` +
        `${lowConfSection}\n\n` +
        `---\n\n` +
        `## Before Merging\n\n` +
        `- [ ] Pull branch locally: ` +
        `\`git fetch && git checkout ${branchName}\`\n` +
        `- [ ] Run the project and verify changes work as expected\n` +
        `- [ ] If anything looks wrong, close this PR and resolve manually\n\n` +
        `*Generated automatically by Overmind Merge Conflict Solver Agent*\n` +
        `*Inference powered by Modal vLLM (Qwen3-4B)*`
    );
}
