import React from "react";
import { Box, Text, useStdout } from "ink";
import ScrollableBox from "./components/ScrollableBox.js";

export interface ActivityEvent {
    username: string;
    event: string;
    timestamp: number;
}

interface ActivityFeedProps {
    events: ActivityEvent[];
    focused?: boolean;
}

const FEED_HEIGHT = 7;

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ActivityFeed({ events, focused = false }: ActivityFeedProps): React.ReactElement {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;

    if (events.length === 0) {
        return (
            <Box paddingX={1} height={3}>
                <Text dimColor>No activity yet.</Text>
            </Box>
        );
    }

    const items = events.map((evt, i) => {
        const line = `${formatTime(evt.timestamp)}  ${evt.username} ${evt.event}`;
        const maxLen = Math.max(width - 4, 20);
        const display = line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;

        return (
            <Text key={i} dimColor wrap="truncate">
                {display}
            </Text>
        );
    });

    return (
        <Box
            flexDirection="column"
            paddingX={1}
            borderStyle={focused ? "single" : undefined}
            borderColor={focused ? "cyan" : undefined}
        >
            <ScrollableBox
                items={items}
                height={FEED_HEIGHT}
                focused={focused}
                autoScrollToEnd={true}
            />
        </Box>
    );
}
