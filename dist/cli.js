#!/usr/bin/env node
/**
 * Purpose: CLI entry point for the `overmind` command.
 *
 * High-level behavior: Provides `host` and `join` sub-commands via
 * commander. In TTY mode renders the Ink UI (App component); in
 * non-TTY (headless/pipe) mode falls back to Phase 1 console logging.
 *
 * Assumptions:
 *  - The server is always local (127.0.0.1) for this build.
 *  - OVERMIND_PORT env var or --port flag sets the port.
 *
 * Invariants:
 *  - Headless mode always produces observable console output.
 *  - TTY mode never starts an Ink app with an unstarted session.
 *  - Session is always started after Ink render (or synchronously in
 *    headless mode) to avoid race conditions.
 */
import os from "os";
import { program } from "commander";
import { render } from "ink";
import React from "react";
import { startOvermindServer } from "./server/index.js";
import { Session } from "./client/session.js";
import { DEFAULT_PORT } from "./shared/constants.js";
import { App } from "./client/ui/App.js";
function getDefaultUsername() {
    try {
        return os.userInfo().username;
    }
    catch {
        return process.env["USER"] ?? "user";
    }
}
program
    .name("overmind")
    .description("Multiplayer terminal coding REPL")
    .version("0.1.0");
// ─── host ─────────────────────────────────────────────────────────────────────
program
    .command("host")
    .description("Start a server and create a new party as host")
    .option("-p, --port <port>", "Port to listen on", String(DEFAULT_PORT))
    .option("-u, --username <username>", "Your username", getDefaultUsername())
    .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const username = opts.username;
    const { reserveParty } = startOvermindServer(port);
    const partyCode = reserveParty();
    const serverUrl = `ws://127.0.0.1:${port}`;
    const isTTY = Boolean(process.stdout.isTTY);
    const session = new Session({
        serverUrl,
        username,
        partyCode,
        silent: isTTY,
    });
    if (isTTY) {
        const { waitUntilExit } = render(React.createElement(App, {
            connection: session.connection,
            session,
        }));
        session.start();
        await waitUntilExit();
    }
    else {
        console.log(`\n  Party code: ${partyCode}\n`);
        console.log(`  Share this code with your team to join.\n`);
        session.start();
    }
});
// ─── join ─────────────────────────────────────────────────────────────────────
program
    .command("join <code>")
    .description("Join an existing party by code")
    .option("-p, --port <port>", "Server port", String(DEFAULT_PORT))
    .option("-u, --username <username>", "Your username", getDefaultUsername())
    .action(async (code, opts) => {
    const port = parseInt(opts.port, 10);
    const username = opts.username;
    const serverUrl = `ws://127.0.0.1:${port}`;
    const isTTY = Boolean(process.stdout.isTTY);
    const session = new Session({
        serverUrl,
        username,
        partyCode: code.toUpperCase(),
        silent: isTTY,
    });
    if (isTTY) {
        const { waitUntilExit } = render(React.createElement(App, {
            connection: session.connection,
            session,
        }));
        session.start();
        await waitUntilExit();
    }
    else {
        console.log(`[join] Connecting to ${serverUrl} as ${username}...`);
        session.start();
    }
});
program.parse();
//# sourceMappingURL=cli.js.map