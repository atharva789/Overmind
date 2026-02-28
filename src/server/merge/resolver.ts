/**
 * Purpose: Call the Modal-deployed vLLM endpoint to resolve merge conflicts.
 * High-level behavior: Resolves each conflicting file via HTTP POST to the
 *   Modal inference endpoint. Retries once on failure. Falls back to the
 *   "ours" side of each conflict block when Modal is unavailable.
 * Assumptions: CONFLICT_RESOLVER_URL points to a running Modal endpoint.
 * Invariants: Never throws. Always returns a FileResolution. Logs are
 *   truncated to avoid leaking full file content.
 */

import { appendFileSync } from "fs";
import type { ConflictingFile, FileResolution } from "./types.js";

const MODAL_ENDPOINT = process.env["CONFLICT_RESOLVER_URL"];
const LOG_PATH = "orchestrator.log";
const TRUNCATE = 200;

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
 * Resolve a single conflicting file via the Modal vLLM endpoint.
 * Retries once on failure. Falls back to "ours" side with low confidence.
 */
export async function resolveFile(
    file: ConflictingFile,
    storyMd: string
): Promise<FileResolution> {
    if (!MODAL_ENDPOINT) {
        log("CONFLICT_RESOLVER_URL not set — using fallback");
        return fallback(
            file,
            "CONFLICT_RESOLVER_URL environment variable not set"
        );
    }

    log(`Resolving ${file.path} via Modal inference...`);

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await fetch(
                `${MODAL_ENDPOINT}/resolve`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        conflicting_file_path: file.path,
                        conflicting_file_content: file.rawContent,
                        story_md: storyMd,
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

            const data = await response.json() as {
                resolved_code: string;
                reasoning: string;
                confidence: "high" | "medium" | "low";
                issues: string[];
            };

            if (
                !data.resolved_code ||
                data.resolved_code.trim().length === 0
            ) {
                throw new Error("Modal returned empty resolved_code");
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
 * the Modal inference endpoint with concurrent requests.
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
 * Used when Modal inference is unavailable or fails after retries.
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
            `Modal inference unavailable (${reason.slice(0, 100)}). ` +
            `Defaulted to 'ours' side of every conflict. ` +
            `Manual review required.`,
        confidence: "low",
        issues: [
            "Modal inference fallback used — review all changes carefully",
        ],
    };
}
