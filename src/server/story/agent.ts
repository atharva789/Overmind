import { GoogleGenAI, Type } from "@google/genai";
import { pool } from "../db.js";
import { writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { GEMINI_MODEL_DEFAULT } from "../../shared/constants.js";

const UNCLUSTERED_THRESHOLD = 5;

// Define the structured JSON schema for Gemini to cluster features
const featureSchema = {
    type: Type.ARRAY,
    description: "A list of newly identified features clustered from the provided user prompts. Group related prompts into a single feature.",
    items: {
        type: Type.OBJECT,
        properties: {
            title: { type: Type.STRING, description: "Short, descriptive title for the feature (e.g. 'Stripe Payment Integration')" },
            description: { type: Type.STRING, description: "A paragraph explaining what this feature is and what the queries under it accomplish." },
            queryIds: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "The list of EXACT string UUIDs of the queries that belong to this clustered feature."
            }
        },
        required: ["title", "description", "queryIds"]
    }
};

export async function checkAndRunStoryAgent(projectRoot: string) {
    const apiKey = process.env["GEMINI_API_KEY"];
    if (!apiKey) {
        console.log("[story-agent] Skipping: GEMINI_API_KEY not set");
        return;
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;

    try {
        const { rows: totalQueries } = await pool.query("SELECT COUNT(*) as count FROM queries");
        const { rows: totalFeatures } = await pool.query("SELECT COUNT(*) as count FROM features");

        // 1. Empty State: Summarize codebase into Core Features
        if (totalQueries[0].count === "0" && totalFeatures[0].count === "0") {
            await generateInitialStory(ai, model, projectRoot);
            return;
        }

        // 2. Populated State: Summarize recent prompts into Recent Features
        const { rows: unclustered } = await pool.query(
            "SELECT id, content, username, created_at FROM queries WHERE feature_id IS NULL ORDER BY created_at ASC"
        );

        if (unclustered.length >= UNCLUSTERED_THRESHOLD) {
            console.log(`[story-agent] Found ${unclustered.length} unclustered queries. Clustering...`);
            await clusterQueriesAndRegenerateStory(ai, model, projectRoot, unclustered);
        }
    } catch (err) {
        console.error("[story-agent] Error running story agent:", err);
    }
}

async function generateInitialStory(ai: GoogleGenAI, model: string, projectRoot: string) {
    console.log("[story-agent] DB is empty. Generating initial story.md from codebase...");

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

Context:
${contextStr}

Output ONLY a valid markdown document with a H1 title, a short intro, and a section "## Core Features" detailing what the app fundamentally does.`;

    const response = await ai.models.generateContent({
        model,
        contents: prompt
    });

    const markdown = response.text;
    if (markdown) {
        await writeFile(join(projectRoot, "story.md"), markdown.trim(), "utf8");
        console.log("[story-agent] Wrote initial story.md");
    }
}

async function clusterQueriesAndRegenerateStory(ai: GoogleGenAI, model: string, projectRoot: string, unclustered: any[]) {
    // Stringify the queries for the LLM
    const queryList = unclustered.map(q => `ID: ${q.id} | User: ${q.username} | Prompt: ${q.content}`).join("\\n");

    const prompt = `You are the Story Agent. Group the following user prompts into distinct, high-level features that the team is working on.
A single feature might cover multiple related prompts. Create a descriptive title and description for each feature, and map the exact query IDs to them.

Prompts:
${queryList}
`;

    const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: featureSchema,
            temperature: 0.1
        }
    });

    const rawJson = response.text;
    if (!rawJson) {
        console.error("[story-agent] No response from Gemini for clustering.");
        return;
    }

    let clusteredFeatures;
    try {
        clusteredFeatures = JSON.parse(rawJson);
    } catch (e) {
        console.error("[story-agent] Failed to parse clustered features JSON:", rawJson);
        return;
    }

    // Insert features and update queries transactionally
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        for (const feature of clusteredFeatures) {
            // Insert feature
            const insertRes = await client.query(
                "INSERT INTO features (title, description) VALUES ($1, $2) RETURNING id",
                [feature.title, feature.description]
            );
            const featureId = insertRes.rows[0].id;

            // Update queries
            if (feature.queryIds && feature.queryIds.length > 0) {
                // Ensure queryIds are actually valid UUIDs (or the ones we provided)
                const ids = feature.queryIds.filter((id: string) => unclustered.some((u) => u.id === id));
                if (ids.length > 0) {
                    await client.query(
                        `UPDATE queries SET feature_id = $1 WHERE id = ANY($2::uuid[])`,
                        [featureId, ids]
                    );
                }
            }
        }

        await client.query("COMMIT");
        console.log(`[story-agent] Successfully clustered ${clusteredFeatures.length} new features.`);
    } catch (e) {
        await client.query("ROLLBACK");
        console.error("[story-agent] Transaction failed while inserting features:", e);
        return;
    } finally {
        client.release();
    }

    // Now regenerate story.md
    await regenerateStoryMarkdown(projectRoot);
}

export async function regenerateStoryMarkdown(projectRoot: string) {
    console.log("[story-agent] Regenerating story.md...");

    // Fetch all features, oldest first
    const { rows: features } = await pool.query(
        "SELECT id, title, description, created_at FROM features ORDER BY created_at ASC"
    );

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
