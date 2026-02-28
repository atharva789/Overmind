/**
 * Purpose: Core Gemini AI logic for resolving merge conflicts in files.
 * High-level behavior: Sends conflict files to Gemini with story context,
 *   parses structured response, retries once on failure, falls back to
 *   "ours" side with low confidence on unrecoverable errors.
 * Assumptions: GEMINI_API_KEY must be set before calling resolve functions.
 * Invariants: Never throws — always returns a FileResolution.
 *   Never logs full file contents or prompt text.
 */

import fsSync from "node:fs";
import { GoogleGenAI } from "@google/genai";
import type { ConflictingFile, FileResolution } from "./types.js";
import {
    MERGE_GEMINI_MODEL,
    MERGE_MAX_RETRIES,
    MERGE_LOG_TRUNCATE_CHARS,
    MERGE_FALLBACK_CONFIDENCE,
} from "../../shared/constants.js";

const GREENLIGHT_LOG = "greenlight.log";

// ─── Logging ───

function resolverLog(msg: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [MERGE-RESOLVER] ${msg}\n`;
    try {
        fsSync.appendFileSync(GREENLIGHT_LOG, line);
    } catch {
        // Logging must not crash resolution
    }
}

function truncate(text: string): string {
    if (text.length <= MERGE_LOG_TRUNCATE_CHARS) return text;
    return `${text.slice(0, MERGE_LOG_TRUNCATE_CHARS)}…`;
}

// ─── Prompt builder ───

function buildPrompt(
    file: ConflictingFile,
    storyMd: string
): string {
    return `You are a merge conflict resolver for Overmind, a multiplayer AI coding tool.

Multiple AI coding agents worked on the same codebase in parallel sandboxes.
Their outputs were merged via git and produced conflicts in this file.
Your job is to resolve every conflict in this file intelligently.

## PROJECT STORY (what all agents were collectively trying to build)
${storyMd}

## CONFLICTING FILE: ${file.path}
${file.rawContent}

## YOUR TASK
1. Read the full file including all conflict markers carefully
2. For each conflict block (<<<<<<< to >>>>>>>):
   - Understand what OURS version was trying to do
   - Understand what THEIRS version was trying to do
   - Cross-reference with story.md to determine which approach
     aligns with the intended outcome
   - Decide: keep ours, keep theirs, or intelligently combine both
3. Produce a fully clean resolved version of the entire file
   with zero conflict markers remaining

## RULES
- Never leave <<<<<<, =======, or >>>>>>> markers in your output
- If both sides add different things that are compatible, combine them
- If both sides are incompatible approaches, use story.md to decide
- Prefer combining over discarding when both versions add value
- When in doubt, prefer the approach most consistent with story.md intent

## RESPONSE FORMAT
Respond with exactly this structure and nothing else:

RESOLVED_CODE:
[the complete clean file content here, no conflict markers]

REASONING:
[1-3 sentences explaining the key decisions you made and why]

CONFIDENCE: high|medium|low

ISSUES:
[comma separated list of concerns, or "none" if no concerns]`;
}

// ─── Response parsing ───

/**
 * Strip markdown code fences (``` or ```lang) from a string.
 * Handles both opening and closing fences.
 */
function stripCodeFences(raw: string): string {
    return raw
        .replace(/^```[a-z]*\n?/im, "")
        .replace(/\n?```$/m, "")
        .trim();
}

function parseGeminiResponse(
    file: ConflictingFile,
    text: string
): FileResolution {
    // Log raw response in debug mode (never in production)
    if (process.env["MERGE_DEBUG"] === "1") {
        resolverLog(
            `DEBUG raw response for ${file.path}:\n` +
            text.slice(0, MERGE_LOG_TRUNCATE_CHARS)
        );
        process.stdout.write(
            `\n─── Gemini raw response for ${file.path} ───\n` +
            text + "\n──────────────────────────\n"
        );
    }

    try {
        // Case-insensitive search for section headers
        const upper = text.toUpperCase();
        const codeMatch = upper.indexOf("RESOLVED_CODE:");
        const reasoningMatch = upper.indexOf("REASONING:");
        const confidenceMatch = upper.indexOf("CONFIDENCE:");
        const issuesMatch = upper.indexOf("ISSUES:");

        if (
            codeMatch === -1 ||
            reasoningMatch === -1 ||
            confidenceMatch === -1 ||
            issuesMatch === -1
        ) {
            resolverLog(
                `Parse failed for ${file.path}: missing section header(s). ` +
                `Headers found: CODE=${codeMatch !== -1}, ` +
                `REASONING=${reasoningMatch !== -1}, ` +
                `CONFIDENCE=${confidenceMatch !== -1}, ` +
                `ISSUES=${issuesMatch !== -1}`
            );
            return fallbackResolution(file);
        }

        // Use original-case text for extraction (preserve code content)
        let resolvedContent = text
            .slice(codeMatch + "RESOLVED_CODE:".length, reasoningMatch)
            .trim();

        // Strip markdown code fences if Gemini wrapped the code
        resolvedContent = stripCodeFences(resolvedContent);

        const reasoning = text
            .slice(reasoningMatch + "REASONING:".length, confidenceMatch)
            .trim();

        const confidenceRaw = text
            .slice(confidenceMatch + "CONFIDENCE:".length, issuesMatch)
            .trim()
            .toLowerCase()
            .split(/\s+/)[0];

        const confidence: "high" | "medium" | "low" =
            confidenceRaw === "high" ? "high" :
            confidenceRaw === "medium" ? "medium" :
            confidenceRaw === "low" ? "low" :
            MERGE_FALLBACK_CONFIDENCE;

        const issuesRaw = text
            .slice(issuesMatch + "ISSUES:".length)
            .trim();

        const issuesFound =
            issuesRaw.toLowerCase() === "none" || issuesRaw === ""
                ? []
                : issuesRaw.split(",").map((s) => s.trim()).filter(Boolean);

        // Validate no conflict markers remain
        const markers = ["<<<<<<<", "=======", ">>>>>>>"];
        for (const marker of markers) {
            if (resolvedContent.includes(marker)) {
                resolverLog(
                    `Parse warning: resolved content for ${file.path} ` +
                    `still has marker ${marker}`
                );
                return fallbackResolution(file);
            }
        }

        return {
            path: file.path,
            resolvedContent,
            reasoning,
            confidence,
            issuesFound,
        };
    } catch {
        return fallbackResolution(file);
    }
}

// ─── Fallback ───

/**
 * Build a fallback resolution that keeps the "ours" side of every
 * conflict block. Used when Gemini fails or returns unparseable output.
 */
function takeOursSideOfEveryConflict(file: ConflictingFile): string {
    const lines = file.rawContent.split("\n");
    const output: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        if (line.startsWith("<<<<<<<")) {
            i++;
            // Keep ours lines
            while (i < lines.length && !lines[i].startsWith("=======")) {
                output.push(lines[i]);
                i++;
            }
            // Skip ======= and theirs lines
            while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
                i++;
            }
            i++; // skip >>>>>>>
        } else {
            output.push(line);
            i++;
        }
    }

    return output.join("\n");
}

function fallbackResolution(file: ConflictingFile): FileResolution {
    return {
        path: file.path,
        resolvedContent: takeOursSideOfEveryConflict(file),
        reasoning:
            "Gemini response could not be parsed — defaulted to ours side",
        confidence: MERGE_FALLBACK_CONFIDENCE,
        issuesFound: ["Parse failure — manual review required"],
    };
}

// ─── Core resolution ───

async function attemptResolve(
    file: ConflictingFile,
    storyMd: string,
    apiKey: string
): Promise<FileResolution> {
    const modelName = process.env["GEMINI_MODEL"] ?? MERGE_GEMINI_MODEL;
    const ai = new GoogleGenAI({ apiKey });

    const prompt = buildPrompt(file, storyMd);

    const chat = ai.chats.create({ model: modelName });
    const response = await chat.sendMessage({ message: prompt });
    const text = response.text ?? "";

    return parseGeminiResponse(file, text);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves all conflicts in a single file using Gemini.
 * Retries once on API failure before returning a fallback.
 * Fallback: returns "ours" side of every conflict with low confidence.
 * Never throws — always returns a FileResolution.
 */
export async function resolveFile(
    file: ConflictingFile,
    storyMd: string
): Promise<FileResolution> {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        throw new Error(
            "GEMINI_API_KEY is required for merge conflict resolution"
        );
    }

    try {
        return await attemptResolve(file, storyMd, apiKey);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        resolverLog(
            `Gemini call failed for ${file.path}: ${msg}`
        );
        if (process.env["MERGE_DEBUG"] === "1") {
            process.stdout.write(`[GEMINI ERROR] ${msg}\n`);
        }

        if (MERGE_MAX_RETRIES > 0) {
            await sleep(2000);
            try {
                return await attemptResolve(file, storyMd, apiKey);
            } catch (retryErr) {
                const retryMsg =
                    retryErr instanceof Error
                        ? retryErr.message
                        : String(retryErr);
                resolverLog(
                    `Retry failed for ${file.path}: ${retryMsg}`
                );
                if (process.env["MERGE_DEBUG"] === "1") {
                    process.stdout.write(
                        `[GEMINI RETRY ERROR] ${retryMsg}\n`
                    );
                }
            }
        }

        return fallbackResolution(file);
    }
}

/**
 * Resolves all conflicting files sequentially.
 * Sequential (not parallel) to avoid Gemini rate limits.
 * Logs each resolution attempt to greenlight.log.
 * Never throws — always returns an array of FileResolution.
 */
export async function resolveAllConflicts(
    files: ConflictingFile[],
    storyMd: string
): Promise<FileResolution[]> {
    const resolutions: FileResolution[] = [];

    for (const file of files) {
        resolverLog(
            `Resolving ${file.path} ` +
            `(${file.conflicts.length} conflict block(s))...`
        );

        let resolution: FileResolution;
        try {
            resolution = await resolveFile(file, storyMd);
        } catch {
            resolution = fallbackResolution(file);
        }

        const confidenceMark =
            resolution.confidence === "low" ? " ⚠️" : "";
        resolverLog(
            `${file.path} resolved — confidence: ` +
            `${resolution.confidence}${confidenceMark} — ` +
            `reasoning: ${truncate(resolution.reasoning)}`
        );

        resolutions.push(resolution);
    }

    return resolutions;
}
