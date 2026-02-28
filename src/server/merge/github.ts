/**
 * Purpose: Open GitHub pull requests for resolved merge conflict branches.
 * High-level behavior: Uses the GitHub REST API via fetch() to create PRs
 *   with structured markdown descriptions explaining each resolution.
 * Assumptions: GITHUB_TOKEN and GITHUB_REPO env vars must be set.
 * Invariants: Never includes user prompt content in PR descriptions.
 *   PR descriptions only contain story.md excerpts and technical reasoning.
 */

import fsSync from "node:fs";
import type { FileResolution, MergeResolutionResult } from "./types.js";

const LOG_FILE = "orchestrator.log";

// ─── Logging ───

function githubLog(msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [MERGE] ${msg}\n`;
    try {
        fsSync.appendFileSync(LOG_FILE, line);
    } catch {
        // Logging must not crash execution
    }
}

// ─── PR description ───

function confidenceEmoji(
    confidence: "high" | "medium" | "low"
): string {
    if (confidence === "high") return "✅ High";
    if (confidence === "medium") return "⚠️ Medium";
    return "❌ Low";
}

function computeOverallConfidence(
    resolutions: FileResolution[]
): "high" | "medium" | "low" {
    if (resolutions.some((r) => r.confidence === "low")) return "low";
    if (resolutions.some((r) => r.confidence === "medium")) return "medium";
    return "high";
}

/**
 * Generates the full PR markdown description.
 * Never includes user prompt content — only story.md and reasoning.
 */
export function generatePRDescription(
    resolutions: FileResolution[],
    partyCode: string,
    storyMd: string,
    branchName: string
): string {
    const overall = computeOverallConfidence(resolutions);
    const storyExcerpt = storyMd.slice(0, 500);
    const lowConf = resolutions.filter((r) => r.confidence === "low");

    const fileSection = resolutions
        .map((r) => {
            const conf = confidenceEmoji(r.confidence);
            const issues =
                r.issuesFound.length === 0
                    ? "None"
                    : r.issuesFound.join(", ");
            return [
                `### \`${r.path}\``,
                `**Confidence:** ${conf}`,
                `**Decision:** ${r.reasoning}`,
                `**Issues:** ${issues}`,
                "",
                "---",
            ].join("\n");
        })
        .join("\n\n");

    const lowConfSection =
        lowConf.length === 0
            ? ""
            : [
                  "## ⚠️ Low Confidence Resolutions",
                  "",
                  ...lowConf.map(
                      (r) => `- \`${r.path}\`: ${r.reasoning}`
                  ),
                  "",
                  "---",
                  "",
              ].join("\n");

    const beforeMerging = [
        "## Before Merging",
        "",
        `- [ ] Pull this branch locally: ` +
            `\`git fetch && git checkout ${branchName}\``,
        "- [ ] Run the project: `npm start` (or equivalent)",
        "- [ ] Verify the changes work as expected",
        "- [ ] If anything looks wrong, close this PR and resolve manually",
        "",
        "*Generated automatically by Overmind Merge Conflict Solver Agent*",
    ].join("\n");

    return [
        "## Overmind Merge Conflict Resolution",
        "",
        `**Party:** ${partyCode}`,
        `**Files resolved:** ${resolutions.length}`,
        `**Overall confidence:** ${overall}`,
        "",
        "---",
        "",
        "## What Was Being Built",
        "",
        storyExcerpt,
        "",
        "---",
        "",
        "## Conflict Resolutions",
        "",
        fileSection,
        "",
        lowConfSection,
        beforeMerging,
    ].join("\n");
}

/**
 * Generates the PR title for the given party and confidence level.
 */
export function generatePRTitle(
    partyCode: string,
    hasLowConfidence: boolean
): string {
    const base = `[Overmind] Merge conflicts resolved — Party ${partyCode}`;
    if (hasLowConfidence) {
        return `⚠️ [Overmind] Merge conflicts resolved (review carefully)` +
            ` — Party ${partyCode}`;
    }
    return base;
}

// ─── GitHub API ───

interface GitHubPRResponse {
    html_url?: string;
    message?: string;
}

/**
 * Opens a GitHub PR for the resolved branch.
 * Uses fetch() directly against the GitHub REST API.
 * Returns the PR URL on success.
 * Logs the PR URL to orchestrator.log.
 * Throws with a clear message if GITHUB_TOKEN or GITHUB_REPO missing.
 */
export async function openPullRequest(
    branchName: string,
    title: string,
    description: string
): Promise<string> {
    const token = process.env["GITHUB_TOKEN"];
    const repo = process.env["GITHUB_REPO"];
    const base =
        process.env["GITHUB_BASE_BRANCH"] ?? "main";

    if (!token) {
        throw new Error(
            "GITHUB_TOKEN environment variable is required to open PRs"
        );
    }
    if (!repo) {
        throw new Error(
            "GITHUB_REPO environment variable is required (format: owner/repo)"
        );
    }

    const url = `https://api.github.com/repos/${repo}/pulls`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            title,
            body: description,
            head: branchName,
            base,
        }),
    });

    const data = (await response.json()) as GitHubPRResponse;

    if (!response.ok) {
        throw new Error(
            `GitHub API error ${response.status}: ` +
            (data.message ?? "unknown error")
        );
    }

    if (!data.html_url) {
        throw new Error("GitHub API returned no PR URL");
    }

    githubLog(`PR opened: ${data.html_url}`);
    return data.html_url;
}

/**
 * Builds a full MergeResolutionResult including PR title and description.
 * Does not open the PR — call openPullRequest() separately.
 */
export function buildResolutionResult(
    resolutions: FileResolution[],
    partyCode: string,
    storyMd: string,
    branchName: string
): Omit<MergeResolutionResult, "prUrl"> {
    const hasLowConfidence = resolutions.some(
        (r) => r.confidence === "low"
    );
    const prTitle = generatePRTitle(partyCode, hasLowConfidence);
    const prDescription = generatePRDescription(
        resolutions,
        partyCode,
        storyMd,
        branchName
    );

    return {
        resolutions,
        prTitle,
        prDescription,
        hasLowConfidence,
        branchName,
    };
}
