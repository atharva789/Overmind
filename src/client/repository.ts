// Purpose: Resolve the local GitHub repository from the current workspace.
// Behavior: Locates .git, reads config, and normalizes the origin remote URL.
// Assumptions: The CLI is executed inside a git worktree with a remote.
// Invariants: Returns null when the repository cannot be validated.

import fs from "node:fs";
import path from "node:path";
import {
    normalizeGithubRepository,
    selectGitRemoteUrl,
} from "../shared/repository.js";

export function resolveGitHubRepository(
    workingDirectory: string = process.cwd()
): string | null {
    const configPath = resolveGitConfigPath(workingDirectory);
    if (!configPath) return null;

    const configText = readGitConfig(configPath);
    if (!configText) return null;

    const remoteUrl = selectGitRemoteUrl(configText);
    if (!remoteUrl) return null;

    return normalizeGithubRepository(remoteUrl);
}

function resolveGitConfigPath(startPath: string): string | null {
    let currentPath = path.resolve(startPath);

    while (true) {
        const dotGitPath = path.join(currentPath, ".git");
        const configPath = resolveConfigFromDotGit(dotGitPath);
        if (configPath) return configPath;

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) return null;
        currentPath = parentPath;
    }
}

function resolveConfigFromDotGit(dotGitPath: string): string | null {
    try {
        const stat = fs.statSync(dotGitPath);
        if (stat.isDirectory()) {
            return path.join(dotGitPath, "config");
        }
        if (stat.isFile()) {
            const fileText = fs.readFileSync(dotGitPath, "utf-8");
            const match = fileText.match(/^gitdir:\s*(.+)$/m);
            if (!match) return null;

            const gitDir = match[1].trim();
            const resolvedDir = path.isAbsolute(gitDir)
                ? gitDir
                : path.resolve(path.dirname(dotGitPath), gitDir);
            return path.join(resolvedDir, "config");
        }
    } catch {
        return null;
    }

    return null;
}

function readGitConfig(configPath: string): string | null {
    try {
        return fs.readFileSync(configPath, "utf-8");
    } catch {
        return null;
    }
}
