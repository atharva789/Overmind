#!/usr/bin/env node
/**
 * Purpose: CLI entry point for the Overmind multiplayer coding agent.
 * High-level behavior: Registers host and join commands; host starts the
 *   WebSocket server, join connects to an existing session.
 * Assumptions: Node.js 20+, running from a git-tracked project directory.
 * Invariants: The join command never initializes local project state.
 */
export {};
