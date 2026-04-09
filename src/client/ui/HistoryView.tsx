/**
 * Purpose: Scrollable chat history — Claude Code-like layout.
 * Renders all HistoryEntry items vertically with auto-scroll.
 * Supports manual scroll via scrollOffset prop from parent.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import Badge from "./components/Badge.js";
import DiffBlock from "./components/DiffBlock.js";
import Spinner from "./components/Spinner.js";
import AgentEventRow from "./components/AgentEventRow.js";
import type {
    HistoryEntry,
    UserPromptEntry,
    StatusEntry,
    AgentEventEntry,
    CompletionEntry,
    ShellEntry,
    MergeEntry,
} from "./types/history.js";

// ─── Props ───

interface HistoryViewProps {
    readonly history: readonly HistoryEntry[];
    readonly expandedEntryId: string | null;
    readonly scrollOffset: number;
}

// ─── Status styling ───

const STATUS_COLORS: Record<string, string> = {
    queued: "blue",
    greenlit: "green",
    "feature-created": "yellow",
    redlit: "red",
    approved: "green",
    denied: "red",
    "execution-queued": "cyan",
    "merge-progress": "cyan",
};

// ─── Entry renderers ───

function renderUserPrompt(entry: UserPromptEntry): React.ReactElement {
    return (
        <Box marginY={0}>
            <Text color="green" bold>{"> "}</Text>
            <Text wrap="wrap">{entry.content}</Text>
        </Box>
    );
}

function renderStatus(entry: StatusEntry): React.ReactElement {
    const color = STATUS_COLORS[entry.status] ?? "gray";
    const label = entry.status.toUpperCase().replace(/-/g, " ");

    return (
        <Box>
            <Text>  </Text>
            <Badge label={label} color={color} />
            {entry.status === "queued" && <Spinner color="blue" />}
            <Text dimColor wrap="truncate"> {entry.message}</Text>
        </Box>
    );
}

function renderAgentEvent(entry: AgentEventEntry, expanded: boolean): React.ReactElement {
    return <AgentEventRow entry={entry} expanded={expanded} />;
}

function renderCompletion(entry: CompletionEntry): React.ReactElement {
    const totalAdded = entry.files.reduce((s, f) => s + f.linesAdded, 0);
    const totalRemoved = entry.files.reduce((s, f) => s + f.linesRemoved, 0);

    return (
        <Box flexDirection="column">
            <Text color="green" bold>
                {"  ✓ Applied "}{entry.files.length} file(s) (+{totalAdded}/-{totalRemoved}).
            </Text>
            {entry.files.map((file, i) => (
                <Box key={`${entry.id}-f-${i}`} flexDirection="column">
                    <DiffBlock filename={file.path} diff={file.diff} />
                </Box>
            ))}
            {entry.summary && (
                <Text dimColor wrap="truncate">{"  "}{entry.summary}</Text>
            )}
        </Box>
    );
}

function renderShell(entry: ShellEntry): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Text color="yellow" bold>{"  $ "}{entry.command}</Text>
            <Text dimColor wrap="truncate">{"    "}{entry.output}</Text>
        </Box>
    );
}

function renderMerge(entry: MergeEntry): React.ReactElement {
    const isError = entry.status === "error";
    return (
        <Box>
            <Text>  </Text>
            <Badge label={isError ? "MERGE ERROR" : "MERGE"} color={isError ? "red" : "cyan"} />
            <Text dimColor> {entry.message}</Text>
        </Box>
    );
}

// ─── Render dispatcher ───

function renderEntry(entry: HistoryEntry, expandedId: string | null): React.ReactElement {
    switch (entry.kind) {
        case "user-prompt": return renderUserPrompt(entry);
        case "status": return renderStatus(entry);
        case "agent-event": return renderAgentEvent(entry, entry.id === expandedId);
        case "completion": return renderCompletion(entry);
        case "shell": return renderShell(entry);
        case "merge": return renderMerge(entry);
    }
}

// ─── Main component ───

export default function HistoryView({
    history,
    expandedEntryId,
    scrollOffset,
}: HistoryViewProps): React.ReactElement {
    const { stdout } = useStdout();
    const height = (stdout?.rows ?? 30) - 8; // reserve space for header, input, activity

    if (history.length === 0) {
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <Text dimColor>No active prompt. Type a prompt below to get started.</Text>
            </Box>
        );
    }

    // scrollOffset=0 means "at bottom" (most recent). Positive = scrolled up.
    const endIndex = history.length - scrollOffset;
    const startIndex = Math.max(0, endIndex - Math.max(height, 5));
    const visible = history.slice(startIndex, endIndex);
    const atBottom = scrollOffset === 0;
    const atTop = startIndex === 0;

    return (
        <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
            {!atTop && (
                <Text dimColor italic>{"  ↑ "}{startIndex} earlier entries (scroll up)</Text>
            )}
            {visible.map((entry) => (
                <Box key={entry.id} flexDirection="column">
                    {renderEntry(entry, expandedEntryId)}
                </Box>
            ))}
            {!atBottom && (
                <Text dimColor italic>{"  ↓ "}{scrollOffset} newer entries (scroll down)</Text>
            )}
        </Box>
    );
}
