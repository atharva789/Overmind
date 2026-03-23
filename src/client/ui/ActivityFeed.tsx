import React from "react";
import { Box, Text, useStdout } from "ink";

export interface ActivityEvent {
    username: string;
    event: string;
    timestamp: number;
}

interface ActivityFeedProps {
    events: readonly ActivityEvent[];
}

const MAX_EVENTS = 5;

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ActivityFeed({ events }: ActivityFeedProps): React.ReactElement {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;

    const visible = events.slice(-MAX_EVENTS);

    if (visible.length === 0) {
        return (
            <Box paddingX={1}>
                <Text dimColor>No activity yet.</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" paddingX={1}>
            {visible.map((evt, i) => {
                const line = `${formatTime(evt.timestamp)}  ${evt.username} ${evt.event}`;
                // Truncate if it overflows
                const maxLen = Math.max(width - 4, 20);
                const display = line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;

                return (
                    <Text key={i} dimColor wrap="truncate">
                        {display}
                    </Text>
                );
            })}
        </Box>
    );
}
