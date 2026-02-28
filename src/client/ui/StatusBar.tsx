// Purpose: Render the top status bar with party and connection info.
// Behavior: Shows party code, member count, and backend availability.
// Assumptions: Execution backend availability is a boolean flag.
// Invariants: Status bar rendering is pure and side-effect free.

import React from "react";
import { Box, Text, useStdout } from "ink";

interface StatusBarProps {
    partyCode: string;
    memberCount: number;
    connectionStatus: "connected" | "reconnecting" | "disconnected";
    executionBackendAvailable?: boolean;
}

export default function StatusBar({
    partyCode,
    memberCount,
    connectionStatus,
    executionBackendAvailable = true,
}: StatusBarProps): React.ReactElement {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;

    const dot = "●";
    const dotColor =
        connectionStatus === "connected"
            ? "green"
            : connectionStatus === "reconnecting"
                ? "yellow"
                : "red";

    const statusLabel =
        connectionStatus === "connected"
            ? "Live"
            : connectionStatus === "reconnecting"
                ? "Reconnecting"
                : "Disconnected";

    const warnings: string[] = [];
    if (!executionBackendAvailable) warnings.push("⚠ Execution offline");

    const content = `OVERMIND · Party: ${partyCode} · ${memberCount} member${memberCount !== 1 ? "s" : ""} · `;

    const maxLen = Math.max(width - 20, 30);
    const truncated = content.length > maxLen ? content.slice(0, maxLen) + "…" : content;

    return (
        <Box
            width={width}
            borderStyle="single"
            borderTop={false}
            borderLeft={false}
            borderRight={false}
            borderBottom={true}
            borderColor="gray"
            paddingX={1}
        >
            <Text bold color="cyan">{truncated}</Text>
            <Text color={dotColor}>{dot}</Text>
            <Text> {statusLabel}</Text>
            {warnings.length > 0 && (
                <Text color="yellow"> {warnings.join(" · ")}</Text>
            )}
        </Box>
    );
}
