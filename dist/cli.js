#!/usr/bin/env node
import { Command } from "commander";
import os from "node:os";
import React from "react";
import { render } from "ink";
import { startServer, reserveParty, shutdownAllParties, setMaxMembers } from "./server/index.js";
import { Session } from "./client/session.js";
import { DEFAULT_PORT, MAX_MEMBERS_DEFAULT } from "./shared/constants.js";
import App from "./client/ui/App.js";
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
    .action(async (opts) => {
    const port = Number(opts.port);
    const username = opts.username ?? getDefaultUsername();
    const maxMem = Number(opts.maxMembers) || MAX_MEMBERS_DEFAULT;
    const isTTY = !!process.stdout.isTTY;
    setMaxMembers(maxMem);
    process.env["OVERMIND_PORT"] = String(port);
    const wss = startServer();
    wss.on("listening", async () => {
        const code = reserveParty(username);
        if (isTTY) {
            // Show banner for 2 seconds
            showBanner(code, maxMem);
            await sleep(2000);
            // Clear banner before rendering TUI
            process.stdout.write("\x1b[2J\x1b[H");
        }
        else {
            console.log(`Party started! Code: ${code} (share this with your team)`);
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
            const inkInstance = render(React.createElement(App, {
                connection: session.connection,
                session,
            }));
            process.on("SIGINT", () => {
                inkInstance.unmount();
                shutdownAllParties();
                setTimeout(() => {
                    wss.close();
                    process.exit(0);
                }, 1000);
            });
        }
        else {
            process.on("SIGINT", () => {
                console.log("\nShutting down...");
                shutdownAllParties();
                setTimeout(() => {
                    wss.close();
                    process.exit(0);
                }, 1000);
            });
        }
    });
});
program
    .command("join")
    .description("Join an existing party")
    .argument("<code>", "Party code to join")
    .option("-s, --server <host>", "Server host", "localhost")
    .option("-p, --port <port>", "Server port", String(DEFAULT_PORT))
    .option("-u, --username <name>", "Username")
    .action((code, opts) => {
    const username = opts.username ?? getDefaultUsername();
    const port = Number(opts.port);
    const isTTY = !!process.stdout.isTTY;
    const session = new Session({
        host: opts.server,
        port,
        partyCode: code.toUpperCase(),
        username,
        silent: isTTY,
    });
    session.connect();
    if (isTTY) {
        const inkInstance = render(React.createElement(App, {
            connection: session.connection,
            session,
        }));
        process.on("SIGINT", () => {
            inkInstance.unmount();
            session.disconnect();
            process.exit(0);
        });
    }
    else {
        process.on("SIGINT", () => {
            console.log("\nLeaving party...");
            session.disconnect();
            process.exit(0);
        });
    }
});
program.parse();
// ─── Helpers ───
function getDefaultUsername() {
    try {
        return os.userInfo().username;
    }
    catch {
        return process.env["USER"] ?? "anonymous";
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function showBanner(code, maxMem) {
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
}
//# sourceMappingURL=cli.js.map