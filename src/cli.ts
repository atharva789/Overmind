#!/usr/bin/env node

import { Command } from "commander";
import os from "node:os";
import React from "react";
import { render } from "ink";
import ngrok from "ngrok";
import { startServer, reserveParty, shutdownAllParties, setMaxMembers } from "./server/index.js";
import { Session } from "./client/session.js";
import { DEFAULT_PORT, MAX_MEMBERS_DEFAULT } from "./shared/constants.js";
import { decodeInviteCode, encodeInviteCode, isInviteCode } from "./shared/invite.js";
import App from "./client/ui/App.js";
import clipboardy from "clipboardy";
import { basename } from "path";
import { pool } from "./server/db.js";
import { generateInitialStory } from "./server/story/agent.js";
import { GoogleGenAI } from "@google/genai";
import * as p from "@clack/prompts";
import { GEMINI_MODEL_DEFAULT } from "./shared/constants.js";

const program = new Command();

program
    .name("overmind")
    .description("Multiplayer terminal coding REPL")
    .version("0.1.0");

program
    .command("host")
    .description("Start server, create a party, and connect as host")
    .option("-p, --port <port>", "Server port", String(DEFAULT_PORT))
    .option("-u, --username <name>", "Host username")
    .option("-m, --max-members <n>", "Max party members", String(MAX_MEMBERS_DEFAULT))
    .action(async (opts: { port: string; username?: string; maxMembers: string }) => {
        const port = Number(opts.port);
        const username = opts.username ?? getDefaultUsername();
        const maxMem = Number(opts.maxMembers) || MAX_MEMBERS_DEFAULT;
        const isTTY = !!process.stdout.isTTY;

        setMaxMembers(maxMem);
        process.env["OVERMIND_PORT"] = String(port);

        const projectRoot = process.env["OVERMIND_PROJECT_ROOT"] ?? process.cwd();
        const projectId = basename(projectRoot);

        // --- Core Features Setup Wizard ---
        try {
            const { rows } = (await pool.query("SELECT COUNT(*) as count FROM features WHERE project_id = $1", [projectId])) as any;
            if (rows[0].count === "0" && isTTY) {
                const apiKey = process.env["GEMINI_API_KEY"];
                if (apiKey) {
                    p.intro(`Welcome to Overmind! Looking at new project: ${projectId}`);
                    const desc = await p.text({
                        message: "What kind of project is this? (e.g. A task manager in React, A python API)",
                        placeholder: "A multiplayer terminal in Typescript",
                    });

                    let initialContext = "";
                    if (!p.isCancel(desc) && desc) {
                        initialContext = `Project Description from Host: ${desc}\n\n`;
                    }

                    p.outro("Great! Setting up Core Features...");
                    const ai = new GoogleGenAI({ apiKey });
                    const model = process.env["OVERMIND_MODEL"] ?? GEMINI_MODEL_DEFAULT;
                    await generateInitialStory(ai, model, projectRoot, projectId, initialContext);
                }
            }
        } catch (e) {
            console.error("[cli] Could not run setup wizard:", e);
        }

        const wss = startServer();

        wss.on("listening", async () => {
            const code = reserveParty(username);
            let inviteCode: string | null = null;
            let publicUrl: string | null = null;

            try {
                publicUrl = await startNgrokTunnel(port);
                inviteCode = encodeInviteCode({
                    partyCode: code,
                    serverUrl: publicUrl.replace(/^tcp:\/\//, "ws://"),
                });
                try {
                    clipboardy.writeSync(inviteCode);
                } catch {
                    // Ignore clipboard errors
                }
            } catch (error) {
                const missingToken = !process.env["NGROK_AUTHTOKEN"];
                const hint = missingToken ? " Set NGROK_AUTHTOKEN to enable public tunnels." : "";
                console.log(`[ngrok] Failed to start tunnel.${hint}`);
                if (error instanceof Error) {
                    console.log(`[ngrok] ${error.message}`);
                }
            }

            if (isTTY) {
                // Show banner for 2 seconds
                showBanner(code, maxMem, inviteCode ?? undefined);
                await sleep(2000);
                // Clear banner before rendering TUI
                process.stdout.write("\x1b[2J\x1b[H");
            } else {
                console.log(`Party started! Code: ${code} (share this with your team)`);
                if (inviteCode) {
                    console.log(`Invite code: ${inviteCode} (copied to clipboard!)`);
                    console.log(`Public URL: ${publicUrl}`);
                }
                console.log(`Waiting for members...`);
            }

            const session = new Session({
                port,
                partyCode: code,
                username,
                silent: isTTY,
            });

            session.connect();

            if (isTTY) {
                const inkInstance = render(
                    React.createElement(App, {
                        connection: session.connection,
                        session,
                        inviteCode: inviteCode ?? undefined,
                    })
                );

                process.on("SIGINT", () => {
                    inkInstance.unmount();
                    shutdownAllParties();
                    setTimeout(() => {
                        void stopNgrokTunnel(publicUrl);
                        wss.close();
                        process.exit(0);
                    }, 1000);
                });
            } else {
                process.on("SIGINT", () => {
                    console.log("\nShutting down...");
                    shutdownAllParties();
                    setTimeout(() => {
                        void stopNgrokTunnel(publicUrl);
                        wss.close();
                        process.exit(0);
                    }, 1000);
                });
            }
        });
    });

program
    .command("join")
    .description("Join an existing party (party code or invite code)")
    .argument("<code>", "Party code or invite code to join")
    .option("-s, --server <host>", "Server host", "localhost")
    .option("-p, --port <port>", "Server port", String(DEFAULT_PORT))
    .option("-u, --username <name>", "Username")
    .action(
        (
            code: string,
            opts: { server: string; port: string; username?: string }
        ) => {
            const username = opts.username ?? getDefaultUsername();
            const port = Number(opts.port);
            const isTTY = !!process.stdout.isTTY;

            const invite = decodeInviteCode(code);
            if (!invite && isInviteCode(code)) {
                console.error("Invalid invite code.");
                process.exit(1);
            }

            const partyCode = invite ? invite.partyCode : code.toUpperCase();
            const serverInput = invite
                ? invite.serverUrl
                : buildServerInput(opts.server, port);
            const serverUrl = normalizeServerUrl(serverInput);

            const session = new Session({
                host: opts.server,
                port,
                serverUrl,
                partyCode,
                username,
                silent: isTTY,
            });

            session.connect();

            if (isTTY) {
                const inkInstance = render(
                    React.createElement(App, {
                        connection: session.connection,
                        session,
                    })
                );

                process.on("SIGINT", () => {
                    inkInstance.unmount();
                    session.disconnect();
                    process.exit(0);
                });
            } else {
                process.on("SIGINT", () => {
                    console.log("\nLeaving party...");
                    session.disconnect();
                    process.exit(0);
                });
            }
        }
    );

program.parse();

// ─── Helpers ───

function getDefaultUsername(): string {
    try {
        return os.userInfo().username;
    } catch {
        return process.env["USER"] ?? "anonymous";
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function showBanner(code: string, maxMem: number, inviteCode?: string): void {
    const lines = [
        "╔═══════════════════════════════════╗",
        "║         O V E R M I N D           ║",
        "║   Multiplayer Coding Terminal     ║",
        "╠═══════════════════════════════════╣",
        `║  Party: ${code}  ·  Members: 1/${maxMem}    ║`,
        "║  Share this code with your team   ║",
        "╚═══════════════════════════════════╝",
    ];
    console.log("");
    for (const line of lines) {
        console.log(`  ${line}`);
    }
    console.log("");
    if (code) {
        console.log(`  Party code: ${code}`);
    }
    if (inviteCode) {
        console.log(`  Invite code: ${inviteCode}`);
    }
    console.log("");
}

function buildServerInput(host: string, port: number): string {
    const trimmed = host.trim();
    if (
        trimmed.startsWith("ws://") ||
        trimmed.startsWith("wss://") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
    ) {
        return trimmed;
    }
    return `${trimmed}:${port}`;
}

function normalizeServerUrl(input: string): string {
    const trimmed = input.trim().replace(/\/$/, "");
    if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
        return trimmed;
    }
    if (trimmed.startsWith("tcp://")) {
        return `ws://${trimmed.slice("tcp://".length)}`;
    }
    if (trimmed.startsWith("http://")) {
        return `ws://${trimmed.slice("http://".length)}`;
    }
    if (trimmed.startsWith("https://")) {
        return `wss://${trimmed.slice("https://".length)}`;
    }
    return `ws://${trimmed}`;
}

async function startNgrokTunnel(port: number): Promise<string> {
    const authtoken = process.env["NGROK_AUTHTOKEN"];
    const tunnel = await ngrok.connect({
        proto: "tcp",
        addr: port,
        authtoken,
    });
    const url =
        typeof tunnel === "string"
            ? tunnel
            : typeof (tunnel as { url?: () => string }).url === "function"
                ? (tunnel as { url: () => string }).url()
                : String(tunnel);
    return url.replace(/\/$/, "");
}

async function stopNgrokTunnel(publicUrl: string | null): Promise<void> {
    if (!publicUrl) {
        return;
    }
    try {
        await ngrok.disconnect(publicUrl);
    } catch {
        // Ignore cleanup errors
    }
    try {
        await ngrok.kill();
    } catch {
        // Ignore cleanup errors
    }
}
