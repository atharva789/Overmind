// Purpose: Render the party member list and status indicators.
// Behavior: Displays each member with host marker and status color.
// Assumptions: Member status strings are controlled by the server.
// Invariants: Rendering is pure and based on current state only.

import React from "react";
import { Box, Text, useStdout } from "ink";

export interface MemberView {
    username: string;
    isHost: boolean;
    status: string;
}

interface PartyPanelProps {
    members: MemberView[];
}

const STATUS_COLORS: Record<string, string> = {
    idle: "green",
    typing: "yellow",
    queued: "blue",
    "awaiting review": "magenta",
    executing: "cyan",
};

export default function PartyPanel({ members }: PartyPanelProps): React.ReactElement {
    const { stdout } = useStdout();
    const termWidth = stdout?.columns ?? 80;

    // Shrink width if terminal is small
    const panelWidth = termWidth < 60 ? 18 : 24;

    return (
        <Box
            flexDirection="column"
            width={panelWidth}
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
        >
            <Text bold color="white">Members</Text>
            {members.map((member, idx) => {
                const prefix = member.isHost ? "★" : " ";
                const statusColor = STATUS_COLORS[member.status] ?? "gray";

                return (
                    <Text key={member.username} wrap="truncate">
                        <Text color="gray">[{idx + 1}]</Text>
                        <Text color="yellow">{prefix}</Text>
                        <Text color={member.isHost ? "yellow" : "white"}>{member.username}</Text>
                        <Text color={statusColor} dimColor> ({member.status})</Text>
                    </Text>
                );
            })}
        </Box>
    );
}
