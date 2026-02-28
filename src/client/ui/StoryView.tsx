// Purpose: Render live story content streamed from the server.
// Behavior: Shows the current story text with a streaming indicator.
// Assumptions: Content is already assembled from sequential StoryChunk events.
// Invariants: Rendering is pure and does not mutate state.

import React from "react";
import { Box, Text, useStdout } from "ink";

interface StoryViewProps {
    content: string;
    streaming: boolean;
    error: string | null;
}

export default function StoryView({
    content,
    streaming,
    error,
}: StoryViewProps): React.ReactElement {
    const { stdout } = useStdout();
    const height = stdout?.rows ?? 30;

    return (
        <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="single"
            borderColor="blue"
            paddingX={1}
            paddingY={0}
            height={height - 8}
        >
            <Box marginBottom={0}>
                <Text bold color="blue">Story Stream</Text>
                <Text dimColor>{streaming ? " (live)" : " (idle)"}</Text>
            </Box>
            <Box flexDirection="column" flexGrow={1}>
                {error && (
                    <Text color="red" wrap="wrap">
                        {error}
                    </Text>
                )}
                {content ? (
                    <Text wrap="wrap">{content}</Text>
                ) : (
                    <Text dimColor>Waiting for story stream...</Text>
                )}
            </Box>
        </Box>
    );
}
