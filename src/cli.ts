#!/usr/bin/env node
import os from "os";
import { program } from "commander";
import { startOvermindServer } from "./server/index.js";
import { Session } from "./client/session.js";
import { DEFAULT_PORT } from "./shared/constants.js";

function getDefaultUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env["USER"] ?? "user";
  }
}

program.name("overmind").description("Multiplayer terminal coding REPL").version("0.1.0");

// ─── host ──────────────────────────────────────────────────────────────────────

program
  .command("host")
  .description("Start a server and create a new party as host")
  .option("-p, --port <port>", "Port to listen on", String(DEFAULT_PORT))
  .option("-u, --username <username>", "Your username", getDefaultUsername())
  .action((opts: { port: string; username: string }) => {
    const port = parseInt(opts.port, 10);
    const username = opts.username;

    const { reserveParty } = startOvermindServer(port);

    // Reserve a party code before connecting
    const partyCode = reserveParty();

    console.log(`\n  Party code: ${partyCode}\n`);
    console.log(`  Share this code with your team to join.\n`);

    const serverUrl = `ws://127.0.0.1:${port}`;

    // Small delay to ensure server event loop is ready
    setTimeout(() => {
      const session = new Session({ serverUrl, username, partyCode });
      session.start();
    }, 50);
  });

// ─── join ──────────────────────────────────────────────────────────────────────

program
  .command("join <code>")
  .description("Join an existing party by code")
  .option("-p, --port <port>", "Server port", String(DEFAULT_PORT))
  .option("-u, --username <username>", "Your username", getDefaultUsername())
  .action((code: string, opts: { port: string; username: string }) => {
    const port = parseInt(opts.port, 10);
    const username = opts.username;
    const serverUrl = `ws://127.0.0.1:${port}`;

    console.log(`[join] Connecting to ${serverUrl} as ${username}...`);

    const session = new Session({
      serverUrl,
      username,
      partyCode: code.toUpperCase(),
    });

    session.start();
  });

program.parse();
