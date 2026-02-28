// Purpose: Analyze project root files to build a stable overview summary.
// Behavior: Reads root-level files and extracts purpose, stack, and layout.
// Assumptions: Root files are UTF-8 text where parsed; missing files are ok.
// Invariants: Output is deterministic for a given root directory snapshot.

import fs from "node:fs";
import path from "node:path";

export interface ProjectAnalysis {
    rootEntries: string[];
    purpose: string;
    architecture: string[];
    techStack: string[];
    abstractions: string[];
}

/**
 * Build a project overview summary from root-level files.
 * Does: Read README/context/package/tsconfig to extract semantics.
 * Does NOT: Traverse subdirectories or infer runtime behavior.
 * Edge cases: Missing files yield placeholder strings.
 * Invariants: The returned summary is deterministic for the same inputs.
 */
export function buildProjectOverview(rootPath: string): string {
    const analysis = analyzeProjectRoot(rootPath);
    return formatProjectOverview(analysis);
}

function analyzeProjectRoot(rootPath: string): ProjectAnalysis {
    const rootEntries = listRootEntries(rootPath);
    const readmeText = readTextFile(rootPath, "README.md");
    const contextText = readTextFile(rootPath, "context.md");
    const packageText = readTextFile(rootPath, "package.json");
    const tsconfigText = readTextFile(rootPath, "tsconfig.json");

    return {
        rootEntries,
        purpose: extractPurpose(readmeText, contextText),
        architecture: extractSectionLines(contextText, "Architecture"),
        techStack: extractTechStack(packageText, tsconfigText),
        abstractions: extractSectionLines(contextText, "Directory Layout"),
    };
}

function listRootEntries(rootPath: string): string[] {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    return entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort((a, b) => a.localeCompare(b));
}

function readTextFile(rootPath: string, name: string): string | null {
    const filePath = path.join(rootPath, name);
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch {
        return null;
    }
}

function extractPurpose(readme: string | null, context: string | null): string {
    const readmePurpose = readFirstNonEmptyLine(readme);
    if (readmePurpose) return readmePurpose;

    const contextPurpose = readFirstNonEmptyLine(context);
    if (contextPurpose) return contextPurpose;

    return "Purpose not documented in root files.";
}

function readFirstNonEmptyLine(text: string | null): string | null {
    if (!text) return null;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) return trimmed.replace(/^#\s*/, "");
    }
    return null;
}

function extractSectionLines(
    context: string | null,
    heading: string
): string[] {
    if (!context) return ["No context section available."];
    const lines = context.split(/\r?\n/);
    const headingLine = `## ${heading}`;
    const sectionLines: string[] = [];
    let inSection = false;

    for (const line of lines) {
        if (line.trim() === headingLine) {
            inSection = true;
            continue;
        }
        if (inSection && line.startsWith("## ")) break;
        if (inSection && line.trim()) {
            sectionLines.push(line.trim());
        }
    }

    return sectionLines.length > 0
        ? sectionLines
        : [`${heading} not documented in context.md.`];
}

function extractTechStack(
    packageText: string | null,
    tsconfigText: string | null
): string[] {
    const items: string[] = [];
    const packageJson = parseJson(packageText);
    const tsconfigJson = parseJson(tsconfigText);

    const dependencies = Object.keys(packageJson?.dependencies ?? {}).sort();
    const devDependencies = Object.keys(
        packageJson?.devDependencies ?? {}
    ).sort();

    if (packageJson?.type === "module") {
        items.push("Node.js ESM");
    }
    if (dependencies.length > 0) {
        items.push(`Dependencies: ${dependencies.join(", ")}`);
    }
    if (devDependencies.length > 0) {
        items.push(`Dev dependencies: ${devDependencies.join(", ")}`);
    }
    if (tsconfigJson?.compilerOptions?.target) {
        items.push(`TypeScript target: ${tsconfigJson.compilerOptions.target}`);
    }

    return items.length > 0 ? items : ["Tech stack not detected."];
}

function parseJson(text: string | null): Record<string, any> | null {
    if (!text) return null;
    try {
        return JSON.parse(text) as Record<string, any>;
    } catch {
        return null;
    }
}

function formatProjectOverview(analysis: ProjectAnalysis): string {
    const lines: string[] = [];
    lines.push("# Project Overview");
    lines.push("");
    lines.push("Root entries:");
    lines.push(...analysis.rootEntries.map((entry) => `- ${entry}`));
    lines.push("");
    lines.push("Purpose:");
    lines.push(`- ${analysis.purpose}`);
    lines.push("");
    lines.push("Architecture:");
    lines.push(...analysis.architecture.map((line) => `- ${line}`));
    lines.push("");
    lines.push("Tech stack:");
    lines.push(...analysis.techStack.map((line) => `- ${line}`));
    lines.push("");
    lines.push("Key abstractions:");
    lines.push(...analysis.abstractions.map((line) => `- ${line}`));
    lines.push("");
    return lines.join("\n");
}
