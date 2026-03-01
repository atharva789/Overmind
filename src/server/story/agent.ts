import { GoogleGenAI, Type } from "@google/genai";
import { pool } from "../db.js";
import { writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { deriveProjectId } from "../../shared/project-id.js";
import { GEMINI_MODEL_DEFAULT } from "../../shared/constants.js";

const ACTIVE_FEATURES_LIMIT = 15;

// Define the structured JSON schema for Gemini to evaluate a new query
const assignmentSchema = {
    type: Type.OBJECT,
    description: "Determine whether the new query belongs to an existing feature from the list, or requires a new feature to be created.",
    properties: {
        action: {
            type: Type.STRING,
            enum: ["assign_existing", "create_new"],
            description: "Choose 'assign_existing' if the query clearly belongs to one of the provided features. Choose 'create_new' if the query represents a fundamentally new feature or direction."
        },
        feature_id: {
            type: Type.STRING,
            description: "If action is 'assign_existing', provide the exact string UUID of the matched feature."
        },
        title: {
            type: Type.STRING,
            description: "If action is 'create_new', provide a short descriptive title for the new feature."
        },
        description: {
            type: Type.STRING,
            description: "If action is 'create_new', provide a paragraph explaining the new feature."
        }
    },
    required: ["action"]
};

export async function checkAndRunStoryAgent(projectRoot: string) {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        console.log("[story-agent] Skipping: GEMINI_API_KEY not set");
        return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;
    const projectId = deriveProjectId(projectRoot);

    try {
        const results: { queryId: string; type: "new_feature" | "existing"; title?: string }[] = [];

        // Continuous State: Semantically cluster each unclustered query
        const { rows: unclustered } = await pool.query(
            "SELECT id, content, username, created_at FROM queries WHERE feature_id IS NULL AND project_id = $1 ORDER BY created_at ASC",
            [projectId]
        ) as { rows: any[] };

        if (unclustered.length > 0) {
            console.log(`[story-agent] Processing ${unclustered.length} unclustered queries...`);
            for (const query of unclustered) {
                const res = await evaluateAndClusterQuery(ai, model, projectRoot, projectId, query);
                if (res) results.push({ queryId: query.id, ...res });
            }
        }

        return results;
    } catch (err) {
        console.error("[story-agent] Error running story agent:", err);
    }
}

export async function generateInitialStory(ai: GoogleGenAI, model: string, projectRoot: string, projectId: string, initialContext: string = "") {
    console.log(`[story-agent] DB is empty for project '${projectId}'. Generating initial story.md from codebase...`);

    // Naively gather high-level project files (package.json, README)
    let contextStr = "Directory listing:\\n";
    try {
        const files = await readdir(projectRoot);
        contextStr += files.join(", ") + "\\n\\n";

        try {
            const pkg = await readFile(join(projectRoot, "package.json"), "utf8");
            contextStr += `package.json:\\n${pkg}\\n\\n`;
        } catch { }

        try {
            const readme = await readFile(join(projectRoot, "README.md"), "utf8");
            contextStr += `README.md:\\n${readme.substring(0, 2000)}\\n\\n`; // Limit size
        } catch { }
    } catch (err) {
        console.log("[story-agent] Could not read project root, proceeding with minimal context.");
    }

    const prompt = `You are a Story Agent for a software project. The database of user prompts is currently empty.
Read the following high-level context about the codebase and write a markdown document summarizing the "Core features" of this application.

${initialContext}

Context:
${contextStr}

Output ONLY a valid markdown document with a H1 title, a short intro, and a section "## Core Features" detailing what the app fundamentally does.`;

    try {
        const response = await ai.models.generateContent({
            model,
            contents: prompt
        });

        const markdown = response.text;
        if (markdown) {
            await writeFile(join(projectRoot, "story.md"), markdown.trim(), "utf8");
            console.log("[story-agent] Wrote initial story.md");
        }
    } catch (err: any) {
        if (err?.status === 429) {
            console.log("[story-agent] Skipped initial generation: Gemini API rate limit exceeded (429).");
        } else {
            console.error("[story-agent] Error generating initial story:", err?.message || err);
        }
    }
}

async function evaluateAndClusterQuery(ai: GoogleGenAI, model: string, projectRoot: string, projectId: string, query: { id: string, username: string, content: string }) {
    // Fetch the most recent active features for this project to provide as context
    const { rows: features } = await pool.query(
        "SELECT id, title, description FROM features WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2",
        [projectId, ACTIVE_FEATURES_LIMIT]
    ) as { rows: any[] };

    const featuresList = features.map(f => `Feature ID: ${f.id} | Title: ${f.title}\nDescription: ${f.description}`).join("\n\n");

    const prompt = `You are the Story Agent for project "${projectId}". Your task is to analyze a new user query and determine if it belongs to an existing feature.

IMPORTANT: Only choose "assign_existing" if the query is CLEARLY and DIRECTLY about the same topic as an existing feature. Superficial keyword overlap is NOT enough. If the query is about a different domain, technology, or problem area, you MUST choose "create_new".

Active Features:
${features.length > 0 ? featuresList : "No features exist yet."}

New Query:
User: ${query.username}
Prompt: ${query.content}
`;

    let response;
    try {
        response = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: assignmentSchema,
                temperature: 0.0
            }
        });
    } catch (err: any) {
        if (err?.status === 429) {
            console.log(`[story-agent] Skipped querying ${query.id}: Gemini API rate limit exceeded (429).`);
        } else {
            console.error(`[story-agent] Error during clustering ${query.id}:`, err?.message || err);
        }
        return;
    }

    const rawJson = response.text;
    if (!rawJson) {
        console.error(`[story-agent] No response from Gemini for query ${query.id}.`);
        return;
    }

    let decision;
    try {
        decision = JSON.parse(rawJson);
    } catch (e) {
        console.error(`[story-agent] Failed to parse decision JSON for query ${query.id}:`, rawJson);
        return;
    }

    let result: { type: "new_feature" | "existing"; title?: string } | undefined;

    const client = await pool.connect();
    try {
        if (decision.action === "assign_existing" && decision.feature_id) {
            // Verify feature actually exists just in case hallucination
            const check = await client.query("SELECT id FROM features WHERE id = $1", [decision.feature_id]);
            if (check.rows.length > 0) {
                await client.query("UPDATE queries SET feature_id = $1 WHERE id = $2", [decision.feature_id, query.id]);
                console.log(`[story-agent] Assigned query to existing Feature: ${decision.feature_id}`);
                result = { type: "existing" };
            } else {
                console.log(`[story-agent] Gemini hallucinated a non-existent feature ID: ${decision.feature_id}. Leaving unclustered.`);
            }
        }
        else if (decision.action === "create_new" && decision.title && decision.description) {
            const insertRes: any = await client.query(
                "INSERT INTO features (project_id, title, description) VALUES ($1, $2, $3) RETURNING id",
                [projectId, decision.title, decision.description]
            );
            const newFeatureId = insertRes.rows[0].id;
            await client.query("UPDATE queries SET feature_id = $1 WHERE id = $2", [newFeatureId, query.id]);
            console.log(`[story-agent] Created new Feature for '${projectId}': ${decision.title} (${newFeatureId})`);
            result = { type: "new_feature", title: decision.title };
        } else {
            console.log(`[story-agent] Invalid decision format from Gemini:`, decision);
        }
    } catch (e) {
        console.error(`[story-agent] Transaction failed for query ${query.id}:`, e);
        return;
    } finally {
        client.release();
    }

    // Now regenerate story.md
    await regenerateStoryMarkdown(projectRoot, projectId);

    return result;
}

export async function regenerateStoryMarkdown(projectRoot: string, projectId: string) {
    console.log(`[story-agent] Regenerating story.md for '${projectId}'...`);

    // Fetch all features, oldest first
    const { rows: features } = await pool.query(
        "SELECT id, title, description, created_at FROM features WHERE project_id = $1 ORDER BY created_at ASC",
        [projectId]
    ) as { rows: any[] };

    if (features.length === 0) return;

    // Everything before the last 3 features is "Core", the last 3 are "Recent"
    // (A simple heuristic, you can adjust as needed)
    const recentCount = Math.min(features.length, 3);
    const coreCount = features.length - recentCount;

    const coreFeatures = features.slice(0, coreCount);
    const recentFeatures = features.slice(coreCount);

    let md = `# Project Story\n\nThis document tracks the core and recent features being built by the Overmind collective.\n\n`;

    if (coreFeatures.length > 0) {
        md += `## Core Features\n\n`;
        for (const f of coreFeatures) {
            md += `### ${f.title}\n${f.description}\n\n`;
        }
    } else {
        md += `## Core Features\n\n*The foundational features are still being established.*\n\n`;
    }

    if (recentFeatures.length > 0) {
        md += `## Recent Features\n\n`;
        for (const f of recentFeatures) {
            md += `### ${f.title}\n${f.description}\n\n`;
        }
    }

    await writeFile(join(projectRoot, "story.md"), md.trim(), "utf8");
    console.log("[story-agent] story.md updated.");
}
