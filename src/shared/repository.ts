// Purpose: Normalize GitHub repository identifiers and parse git config text.
// Behavior: Converts remote URLs into a canonical slug and selects a remote.
// Assumptions: Only github.com repositories are valid for Overmind sessions.
// Invariants: Functions are pure and return null for invalid inputs.

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

export function normalizeGithubRepository(raw: string): string | null {
    const trimmedValue = raw.trim();
    if (!trimmedValue) return null;

    const parsed = parseRemoteHostAndPath(trimmedValue);
    if (!parsed) return null;

    return normalizeRepositoryPath(parsed.host, parsed.path);
}

export function selectGitRemoteUrl(configText: string): string | null {
    const lines = configText.split(/\r?\n/);
    let currentRemote: string | null = null;
    let originUrl: string | null = null;
    let firstRemoteUrl: string | null = null;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        const remoteMatch = trimmedLine.match(/^\[remote\s+"([^"]+)"\]$/);
        if (remoteMatch) {
            currentRemote = remoteMatch[1];
            continue;
        }

        const urlMatch = trimmedLine.match(/^url\s*=\s*(.+)$/);
        if (!urlMatch || !currentRemote) continue;

        const urlValue = urlMatch[1].trim();
        if (!urlValue) continue;

        if (!firstRemoteUrl) firstRemoteUrl = urlValue;
        if (currentRemote === "origin") originUrl = urlValue;
    }

    return originUrl ?? firstRemoteUrl;
}

function parseRemoteHostAndPath(
    raw: string
): { host: string; path: string } | null {
    const directMatch = raw.match(/^(github\.com)\/(.+)$/i);
    if (directMatch) {
        return { host: directMatch[1], path: directMatch[2] };
    }

    const sshMatch = raw.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) {
        return { host: sshMatch[1], path: sshMatch[2] };
    }

    const urlMatch = raw.match(/^(?:https?|ssh|git):\/\/([^/]+)\/(.+)$/);
    if (urlMatch) {
        return { host: urlMatch[1], path: urlMatch[2] };
    }

    return null;
}

function normalizeRepositoryPath(host: string, path: string): string | null {
    const normalizedHost = host.toLowerCase();
    if (!GITHUB_HOSTS.has(normalizedHost)) return null;

    const cleanedPath = path.replace(/^\/+/, "").replace(/\.git$/i, "");
    const segments = cleanedPath.split("/").filter(Boolean);
    if (segments.length !== 2) return null;

    const owner = segments[0].toLowerCase();
    const repository = segments[1].toLowerCase();

    return `github.com/${owner}/${repository}`;
}
