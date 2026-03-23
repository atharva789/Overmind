/**
 * Purpose: Scrollable list that renders the full chat history,
 *          replacing the old OutputView in the main content area.
 * High-level behavior: Renders all HistoryEntry items in a
 *          vertical list. Auto-scrolls to the bottom on new
 *          entries. Each entry type has a dedicated renderer.
 * Assumptions: Parent provides the full history array and the
 *          currently expanded entry id (if any).
 * Invariants: History entries are never mutated; the list is
 *             append-only from the reducer.
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

function renderUserPrompt(
    entry: UserPromptEntry
): React.ReactElement {
    return (
        <Box>
            <Text color="white" bold>{">"} </Text>
            <Text>{entry.content}</Text>
        </Box>
    );
}

function renderStatus(entry: StatusEntry): React.ReactElement {
    const color = STATUS_COLORS[entry.status] ?? "gray";
    const label = entry.status.toUpperCase().replace(/-/g, " ");

    return (
        <Box flexDirection="column">
            <Box>
                <Badge label={label} color={color} />
                {entry.status === "queued" && (
                    <Spinner color="blue" />
                )}
            </Box>
            <Text color="gray" wrap="truncate">
                {"  "}{entry.message}
            </Text>
        </Box>
    );
}

function renderAgentEvent(
    entry: AgentEventEntry,
    expanded: boolean
): React.ReactElement {
    return (
        <AgentEventRow entry={entry} expanded={expanded} />
    );
}

function renderCompletion(
    entry: CompletionEntry
): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Text bold color="green">
                {"+"} Execution Complete
            </Text>
            {entry.files.map((file, fileIndex) => (
                <Box
                    key={`${entry.id}-file-${fileIndex}`}
                    flexDirection="column"
                >
                    <DiffBlock
                        filename={file.path}
                        diff={file.diff}
                    />
                </Box>
            ))}
            <Text bold>{entry.summary}</Text>
        </Box>
    );
}

function renderShell(entry: ShellEntry): React.ReactElement {
    return (
        <Box flexDirection="column">
            <Text color="yellow">{"$"} {entry.command}</Text>
            <Text dimColor>{entry.output}</Text>
        </Box>
    );
}

function renderMerge(entry: MergeEntry): React.ReactElement {
    const isError = entry.status === "error";
    const color = isError ? "red" : "cyan";

    return (
        <Box>
            <Badge
                label={isError ? "MERGE ERROR" : "MERGE"}
                color={color}
            />
            <Text color="gray"> {entry.message}</Text>
        </Box>
    );
}

// ─── Render dispatcher ───

function renderEntry(
    entry: HistoryEntry,
    expandedEntryId: string | null
): React.ReactElement {
    switch (entry.kind) {
        case "user-prompt":
            return renderUserPrompt(entry);
        case "status":
            return renderStatus(entry);
        case "agent-event":
            return renderAgentEvent(
                entry,
                entry.id === expandedEntryId
            );
        case "completion":
            return renderCompletion(entry);
        case "shell":
            return renderShell(entry);
        case "merge":
            return renderMerge(entry);
    }
}

// ─── Main component ───

const MAX_VISIBLE_ENTRIES = 50;

export default function HistoryView({
    history,
    expandedEntryId,
}: HistoryViewProps): React.ReactElement {
    const { stdout } = useStdout();
    const terminalHeight = stdout?.rows ?? 30;

    // Compute visible window: show the most recent entries
    // that fit in the available terminal space.
    const maxItems = Math.min(
        MAX_VISIBLE_ENTRIES,
        Math.max(terminalHeight - 10, 3)
    );
    const visible = history.slice(-maxItems);

    if (visible.length === 0) {
        return (
            <Box
                flexDirection="column"
                flexGrow={1}
                paddingX={1}
            >
                <Text dimColor>
                    No active prompt. Type a prompt below
                    to get started.
                </Text>
            </Box>
        );
    }

    return (
        <Box
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
        >
            {visible.map((entry) => (
                <Box key={entry.id}>
                    {renderEntry(entry, expandedEntryId)}
                </Box>
            ))}
        </Box>
    );
}
