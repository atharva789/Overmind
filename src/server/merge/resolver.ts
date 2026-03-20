/**
 * Purpose: Call the OpenAI API to resolve merge conflicts.
 * High-level behavior: Resolves each conflicting file via OpenAI chat
 *   completions. Retries once on failure. Falls back to the "ours" side
 *   of each conflict block when the API is unavailable.
 * Assumptions: OPENAI_API_KEY is set.
 * Invariants: Never throws. Always returns a FileResolution. Logs are
 *   truncated to avoid leaking full file content.
 */

import { appendFileSync } from "fs";
import type { ConflictingFile, FileResolution } from "./types.js";

const OPENAI_API_KEY = process.env["OPENAI_API_KEY"];
const OPENAI_MODEL = process.env["MODEL_ID"] ?? "gpt-4o";
const LOG_PATH = "orchestrator.log";
const TRUNCATE = 200;

const RESOLVE_SYSTEM_PROMPT = `You are a merge conflict resolver. Given a file with Git conflict markers and project context, produce the correctly merged file.

Respond with ONLY valid JSON (no markdown fences):
{
  "resolved_code": "<full file content with conflicts resolved>",
  "reasoning": "<brief explanation of resolution strategy>",
  "confidence": "high" | "medium" | "low",
  "issues": ["<any concerns or caveats>"]
}`;

function log(msg: string): void {
    const line =
        `[${new Date().toISOString()}] [MERGE-RESOLVER] ${msg}\n`;
    process.stdout.write(line);
    try {
        appendFileSync(LOG_PATH, line);
    } catch {
        // Log failures must not crash resolution.
    }
}

/**
 * Resolve a single conflicting file via OpenAI chat completions.
 * Retries once on failure. Falls back to "ours" side with low confidence.
 */
export async function resolveFile(
    file: ConflictingFile,
    storyMd: string
): Promise<FileResolution> {
    if (!OPENAI_API_KEY) {
        log("OPENAI_API_KEY not set — using fallback");
        return fallback(
            file,
            "OPENAI_API_KEY environment variable not set"
        );
    }

    log(`Resolving ${file.path} via OpenAI API...`);

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetch(
                "https://api.openai.com/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${OPENAI_API_KEY}`,
                    },
                    body: JSON.stringify({
                        model: OPENAI_MODEL,
                        temperature: 0,
                        messages: [
                            { role: "system", content: RESOLVE_SYSTEM_PROMPT },
                            {
                                role: "user",
                                content: [
                                    `File: ${file.path}`,
                                    `Project context:\n${storyMd}`,
                                    `Conflicting content:\n${file.rawContent}`,
                                ].join("\n\n"),
                            },
                        ],
                    }),
                    signal: AbortSignal.timeout(120_000),
                }
            );

            if (!response.ok) {
                const body = await response.text();
                throw new Error(
                    `HTTP ${response.status}: ${body.slice(0, TRUNCATE)}`
                );
            }

            const completion = await response.json() as {
                choices: Array<{ message: { content: string } }>;
            };

            const raw = completion.choices[0]?.message?.content ?? "";
            const data = JSON.parse(raw) as {
                resolved_code: string;
                reasoning: string;
                confidence: "high" | "medium" | "low";
                issues: string[];
            };

            if (
                !data.resolved_code ||
                data.resolved_code.trim().length === 0
            ) {
                throw new Error("LLM returned empty resolved_code");
            }

            const markers = ["<<<<<<<", "=======", ">>>>>>>"];
            if (markers.some((m) => data.resolved_code.includes(m))) {
                throw new Error(
                    "Resolved code still contains conflict markers"
                );
            }

            log(
                `${file.path} resolved — confidence: ${data.confidence}` +
                ` — reasoning: ${data.reasoning.slice(0, TRUNCATE)}`
            );

            return {
                path: file.path,
                resolvedContent: data.resolved_code,
                reasoning: data.reasoning,
                confidence: data.confidence,
                issues: data.issues ?? [],
            };

        } catch (err) {
            const msg = err instanceof Error
                ? err.message : String(err);
            log(
                `Attempt ${attempt} failed for ${file.path}: ` +
                msg.slice(0, TRUNCATE)
            );
            if (attempt === 2) {
                return fallback(file, msg);
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
    }

    return fallback(file, "Unexpected exit from retry loop");
}

/**
 * Resolve all conflicting files sequentially to avoid overwhelming
 * the OpenAI API with concurrent requests.
 */
export async function resolveAllConflicts(
    files: ConflictingFile[],
    storyMd: string
): Promise<FileResolution[]> {
    log(`Starting resolution of ${files.length} conflicting file(s)`);
    const results: FileResolution[] = [];
    for (const file of files) {
        results.push(await resolveFile(file, storyMd));
    }
    log(`All ${files.length} file(s) resolved`);
    return results;
}

/**
 * Fallback: take the "ours" side of every conflict block.
 * Used when OpenAI API is unavailable or fails after retries.
 * Always returns low confidence so the host knows to review carefully.
 */
function fallback(
    file: ConflictingFile,
    reason: string
): FileResolution {
    log(
        `Using fallback for ${file.path}: ${reason.slice(0, TRUNCATE)}`
    );

    let resolved = "";
    const lines = file.rawContent.split("\n");
    let inTheirs = false;

    for (const line of lines) {
        if (line.startsWith("<<<<<<<")) {
            inTheirs = false;
            continue;
        }
        if (line.startsWith("=======")) {
            inTheirs = true;
            continue;
        }
        if (line.startsWith(">>>>>>>")) {
            inTheirs = false;
            continue;
        }
        if (!inTheirs) {
            resolved += line + "\n";
        }
    }

    return {
        path: file.path,
        resolvedContent: resolved.trimEnd(),
        reasoning:
            `OpenAI API unavailable (${reason.slice(0, 100)}). ` +
            `Defaulted to 'ours' side of every conflict. ` +
            `Manual review required.`,
        confidence: "low",
        issues: [
            "LLM inference fallback used — review all changes carefully",
        ],
    };
}
