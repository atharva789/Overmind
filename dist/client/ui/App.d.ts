/**
 * Purpose: Root TUI component that owns all client-side state
 *          and routes WebSocket messages into reducer actions.
 * High-level behavior: Uses a useReducer with a unified
 *          `history: HistoryEntry[]` array. Every event
 *          (prompts, statuses, agent streams, completions)
 *          appends to history so the user sees a scrollable
 *          chat log instead of ephemeral replacements.
 * Assumptions: Connection and Session are injected as props.
 * Invariants: State is never mutated; all updates produce new
 *             objects via spread. Prompt content is never
 *             broadcast to non-host members.
 */
import React from "react";
import type { Connection } from "../connection.js";
import type { Session } from "../session.js";
interface AppProps {
    connection: Connection;
    session: Session;
    inviteCode?: string;
}
export default function App({ connection, session, inviteCode, }: AppProps): React.ReactElement;
export {};
