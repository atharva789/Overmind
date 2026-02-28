// Purpose: Render prompt lifecycle output entries for the active prompt.
// Behavior: Shows badges, messages, and a spinner for queued items.
// Assumptions: Output entries are pre-filtered by prompt ID.
// Invariants: Rendering is pure and does not mutate state.

import React from "react";
import { Box, Text, useStdout } from "ink";
import Spinner from "./components/Spinner.js";
import Badge from "./components/Badge.js";

export type OutputStatus =
    | "queued"
    | "approved"
    | "denied"
    | "diff"
    | "complete"
    | "error";

export interface OutputEntry {
    id: string;
    promptId: string;
    status: OutputStatus;
    message: string;
    timestamp: number;
}

interface OutputViewProps {
    outputs: OutputEntry[];
    currentPromptId: string | null;
}

const STATUS_CONFIG: Record<OutputStatus, { color: string; label: string }> = {
    queued: { color: "blue", label: "QUEUED" },
    approved: { color: "green", label: "APPROVED" },
    denied: { color: "red", label: "DENIED" },
    diff: { color: "cyan", label: "DIFF" },
    complete: { color: "green", label: "COMPLETE" },
    error: { color: "red", label: "ERROR" },
};

const MAX_VISIBLE = 20;

export default function OutputView({
    outputs,
    currentPromptId,
}: OutputViewProps): React.ReactElement {
    const { stdout } = useStdout();
    const height = stdout?.rows ?? 30;

    // Only show outputs for the current prompt
    const filtered = currentPromptId
        ? outputs.filter((o) => o.promptId === currentPromptId)
        : [];

    // Show last N entries based on available space
    const maxItems = Math.min(MAX_VISIBLE, Math.max(height - 10, 3));
    const visible = filtered.slice(-maxItems);

    if (visible.length === 0) {
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <Text dimColor>No active prompt. Type a prompt below to get started.</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
            {visible.map((entry) => {
                const config = STATUS_CONFIG[entry.status];
                const isActive = entry.status === "queued";

                return (
                    <Box key={entry.id} flexDirection="column" marginBottom={0}>
                        <Box>
                            <Badge label={config.label} color={config.color} />
                            {isActive && <Spinner color="blue" />}
                        </Box>
                        <Text color="gray" wrap="truncate">
                            {"  "}{entry.message}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
