import { execSync } from "node:child_process";
import { basename } from "path";

export function deriveProjectId(projectRoot: string): string {
    // Try git remote origin URL first
    try {
        const url = execSync("git config --get remote.origin.url", {
            cwd: projectRoot,
            stdio: ["ignore", "pipe", "ignore"],
        }).toString().trim();
        if (url) {
            // Extract repo name: "git@github.com:user/repo.git" → "repo"
            const match = url.match(/\/([^/]+?)(?:\.git)?$/);
            if (match) return match[1];
        }
    } catch {}

    // Fall back to directory name
    return basename(projectRoot);
}
