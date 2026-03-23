/**
 * Purpose: Claude Code-like renderers for agent stream events.
 * Shows tool calls, thinking, agent lifecycle inline in history.
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "./Spinner.js";
import type { AgentEventEntry } from "../types/history.js";

interface AgentEventRowProps {
    readonly entry: AgentEventEntry;
    readonly expanded: boolean;
}

const MAX_COLLAPSED = 120;

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "\u2026";
}

function extractContent(entry: AgentEventEntry): string {
    const d = entry.data;
    if (typeof d["content"] === "string") return d["content"];
    if (typeof d["summary"] === "string") return d["summary"];
    if (typeof d["outputPreview"] === "string") return d["outputPreview"];
    if (typeof d["stage"] === "string") return d["stage"];
    return "";
}

function renderPlanReady(entry: AgentEventEntry, expanded: boolean): React.ReactElement {
    const tasks = Array.isArray(entry.data["tasks"]) ? entry.data["tasks"] : [];
    return (
        <Box flexDirection="column">
            <Text color="cyan" bold>{"  Plan: "}{tasks.length} task(s)</Text>
            {tasks.map((task: unknown, i: number) => {
                const t = task as Record<string, unknown>;
                const name = String(t?.["taskName"] ?? t ?? `Task ${i + 1}`);
                const desc = typeof t?.["taskDescription"] === "string"
                    ? ` — ${expanded ? t["taskDescription"] : truncate(t["taskDescription"] as string, 60)}`
                    : "";
                return (
                    <Text key={i} dimColor>
                        {"    "}{i + 1}. <Text color="white">{name}</Text>{desc}
                    </Text>
                );
            })}
        </Box>
    );
}

function renderAgentSpawned(entry: AgentEventEntry): React.ReactElement {
    const name = String(entry.data["taskName"] ?? "agent");
    const desc = typeof entry.data["taskDescription"] === "string"
        ? truncate(entry.data["taskDescription"] as string, 80)
        : "";
    return (
        <Box>
            <Spinner color="yellow" />
            <Text color="yellow" bold> {name}</Text>
            {desc ? <Text dimColor> — {desc}</Text> : null}
        </Box>
    );
}

function renderAgentFinished(entry: AgentEventEntry, expanded: boolean): React.ReactElement {
    const name = String(entry.data["taskName"] ?? "agent");
    const summary = extractContent(entry);
    const files = Array.isArray(entry.data["filesChanged"]) ? entry.data["filesChanged"] as string[] : [];
    return (
        <Box flexDirection="column">
            <Text>
                <Text color="green" bold>{"  ✓ "}{name}</Text>
                {files.length > 0 && <Text dimColor> ({files.length} file{files.length > 1 ? "s" : ""})</Text>}
            </Text>
            {summary && (
                <Text dimColor wrap="truncate">
                    {"    "}{expanded ? summary : truncate(summary, MAX_COLLAPSED)}
                </Text>
            )}
        </Box>
    );
}

function renderToolStart(entry: AgentEventEntry): React.ReactElement {
    const tool = String(entry.data["toolName"] ?? "tool");
    const agent = String(entry.data["taskName"] ?? "");
    return (
        <Text>
            <Text color="yellow">{"  ⚡ "}</Text>
            <Text>{tool}</Text>
            {agent ? <Text dimColor> ({agent})</Text> : null}
        </Text>
    );
}

function renderToolResult(entry: AgentEventEntry, expanded: boolean): React.ReactElement {
    const tool = String(entry.data["toolName"] ?? "tool");
    const ok = entry.data["success"] !== false;
    const output = extractContent(entry);
    const display = expanded ? output : truncate(output, MAX_COLLAPSED);
    return (
        <Box flexDirection="column">
            <Text>
                <Text color={ok ? "green" : "red"} bold>{ok ? "  ✓ " : "  ✗ "}</Text>
                <Text>{tool}</Text>
            </Text>
            {display ? (
                <Text dimColor wrap="truncate">{"    "}{display}</Text>
            ) : null}
        </Box>
    );
}

function renderThinking(entry: AgentEventEntry, expanded: boolean): React.ReactElement {
    const content = extractContent(entry);
    const display = expanded ? content : truncate(content, MAX_COLLAPSED);
    const agent = String(entry.data["taskName"] ?? "");
    return (
        <Text wrap="truncate">
            <Text color="magenta" dimColor>{"  💭 "}</Text>
            {agent ? <Text dimColor>[{agent}] </Text> : null}
            <Text dimColor italic>{display}</Text>
        </Text>
    );
}

function renderStage(entry: AgentEventEntry): React.ReactElement {
    const stage = String(entry.data["stage"] ?? "");
    return (
        <Box>
            <Text color="blue">{"  → "}</Text>
            <Text>{stage}</Text>
        </Box>
    );
}

export default function AgentEventRow({ entry, expanded }: AgentEventRowProps): React.ReactElement {
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
            return <Text dimColor>{"  "}{extractContent(entry)}</Text>;
    }
}
