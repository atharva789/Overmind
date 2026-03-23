/**
 * Purpose: Compact one-line renderers for each agent stream
 *          event type inside the scrollable history.
 * High-level behavior: Maps AgentEventType to an icon + text
 *          representation. Supports an expanded mode (Ctrl+O)
 *          that shows full untruncated content.
 * Assumptions: Parent provides the entry and expansion state.
 * Invariants: Never exceeds one visual line when collapsed.
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "./Spinner.js";
import type { AgentEventEntry } from "../types/history.js";

interface AgentEventRowProps {
    readonly entry: AgentEventEntry;
    readonly expanded: boolean;
}

const MAX_COLLAPSED_LENGTH = 80;

/** Truncate text to a max length, appending ellipsis. */
function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + "\u2026";
}

/** Extract a display string from the entry data. */
function extractContent(entry: AgentEventEntry): string {
    const data = entry.data;
    if (typeof data["content"] === "string") return data["content"];
    if (typeof data["summary"] === "string") return data["summary"];
    if (typeof data["output"] === "string") return data["output"];
    if (typeof data["stage"] === "string") return data["stage"];
    if (typeof data["taskName"] === "string") {
        return data["taskName"];
    }
    if (typeof data["toolName"] === "string") {
        return data["toolName"];
    }
    return "";
}

function renderPlanReady(
    entry: AgentEventEntry,
    expanded: boolean
): React.ReactElement {
    const tasks = Array.isArray(entry.data["tasks"])
        ? (entry.data["tasks"] as string[])
        : [];
    const summary = `Plan: ${tasks.length} task(s)`;

    if (!expanded || tasks.length === 0) {
        const taskNames = tasks.join(", ");
        const display = taskNames
            ? `${summary} - ${truncate(taskNames, MAX_COLLAPSED_LENGTH - summary.length - 3)}`
            : summary;
        return (
            <Text>
                <Text color="cyan" bold>{"# "}</Text>
                <Text>{display}</Text>
            </Text>
        );
    }

    return (
        <Box flexDirection="column">
            <Text>
                <Text color="cyan" bold>{"# "}</Text>
                <Text bold>{summary}</Text>
            </Text>
            {tasks.map((task, index) => (
                <Text key={index} dimColor>
                    {"    "}{index + 1}. {String(task)}
                </Text>
            ))}
        </Box>
    );
}

function renderAgentSpawned(
    entry: AgentEventEntry
): React.ReactElement {
    const taskName = String(entry.data["taskName"] ?? "agent");
    return (
        <Box>
            <Spinner color="yellow" />
            <Text> {taskName}</Text>
        </Box>
    );
}

function renderAgentFinished(
    entry: AgentEventEntry,
    expanded: boolean
): React.ReactElement {
    const taskName = String(entry.data["taskName"] ?? "agent");
    const summary = extractContent(entry);
    const display = expanded
        ? summary
        : truncate(summary, MAX_COLLAPSED_LENGTH);

    return (
        <Text>
            <Text color="green" bold>{"+ "}</Text>
            <Text bold>{taskName}</Text>
            {display ? <Text dimColor> {display}</Text> : null}
        </Text>
    );
}

function renderToolStart(
    entry: AgentEventEntry
): React.ReactElement {
    const toolName = String(entry.data["toolName"] ?? "tool");
    return (
        <Text>
            <Text color="yellow">{"* "}</Text>
            <Text>{toolName}</Text>
        </Text>
    );
}

function renderToolResult(
    entry: AgentEventEntry,
    expanded: boolean
): React.ReactElement {
    const toolName = String(entry.data["toolName"] ?? "tool");
    const success = entry.data["success"] !== false;
    const output = extractContent(entry);
    const display = expanded
        ? output
        : truncate(output, MAX_COLLAPSED_LENGTH);
    const icon = success ? "+" : "x";
    const color = success ? "green" : "red";

    return (
        <Text>
            <Text color={color} bold>{icon} </Text>
            <Text>{toolName}</Text>
            {display ? <Text dimColor> {display}</Text> : null}
        </Text>
    );
}

function renderThinking(
    entry: AgentEventEntry,
    expanded: boolean
): React.ReactElement {
    const content = extractContent(entry);
    const display = expanded
        ? content
        : truncate(content, MAX_COLLAPSED_LENGTH);

    return (
        <Text>
            <Text color="magenta" dimColor>{"~ "}</Text>
            <Text dimColor>{display}</Text>
        </Text>
    );
}

function renderStage(entry: AgentEventEntry): React.ReactElement {
    const stage = String(entry.data["stage"] ?? "");
    return (
        <Text>
            <Text color="blue">{"- "}</Text>
            <Text>{stage}</Text>
        </Text>
    );
}

export default function AgentEventRow({
    entry,
    expanded,
}: AgentEventRowProps): React.ReactElement {
    switch (entry.eventType) {
        case "plan-ready":
            return renderPlanReady(entry, expanded);
        case "agent-spawned":
            return renderAgentSpawned(entry);
        case "agent-finished":
            return renderAgentFinished(entry, expanded);
        case "tool-start":
            return renderToolStart(entry);
        case "tool-result":
            return renderToolResult(entry, expanded);
        case "thinking":
            return renderThinking(entry, expanded);
        case "stage":
            return renderStage(entry);
        default:
            return (
                <Text dimColor>
                    {"  "}{extractContent(entry)}
                </Text>
            );
    }
}
