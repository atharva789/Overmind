import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

export interface ReviewRequest {
    promptId: string;
    username: string;
    content: string;
    reasoning: string;
    conflicts: string[];
}

interface ReviewPanelProps {
    request: ReviewRequest;
    onApprove: (promptId: string) => void;
    onDeny: (promptId: string, reason: string) => void;
}

export default function ReviewPanel({
    request,
    onApprove,
    onDeny,
}: ReviewPanelProps): React.ReactElement {
    const [mode, setMode] = useState<"choose" | "deny">("choose");
    const [denyReason, setDenyReason] = useState("");

    useInput(
        useCallback(
            (input: string, key: { escape?: boolean }) => {
                if (mode === "choose") {
                    if (input === "a" || input === "A") {
                        onApprove(request.promptId);
                    } else if (input === "d" || input === "D") {
                        setMode("deny");
                    }
                } else if (mode === "deny") {
                    if (key.escape) {
                        setMode("choose");
                        setDenyReason("");
                    }
                }
            },
            [mode, request.promptId, onApprove]
        )
    );

    const handleDenySubmit = useCallback(
        (value: string) => {
            const trimmed = value.trim();
            if (trimmed) {
                onDeny(request.promptId, trimmed);
                setDenyReason("");
                setMode("choose");
            }
        },
        [request.promptId, onDeny]
    );

    return (
        <Box
            flexDirection="column"
            borderStyle="double"
            borderColor="magenta"
            paddingX={1}
            paddingY={0}
        >
            <Text bold color="magenta">⚠ Host Review Required</Text>
            <Text> </Text>

            <Box>
                <Text bold>From: </Text>
                <Text color="cyan">{request.username}</Text>
            </Box>

            <Box flexDirection="column" marginTop={0}>
                <Text bold>Prompt:</Text>
                <Text color="white" wrap="wrap">
                    {"  "}{request.content}
                </Text>
            </Box>

            {request.reasoning && (
                <Box flexDirection="column" marginTop={0}>
                    <Text bold>Agent reasoning:</Text>
                    <Text color="yellow" dimColor wrap="wrap">
                        {"  "}{request.reasoning}
                    </Text>
                </Box>
            )}

            {request.conflicts.length > 0 && (
                <Box flexDirection="column" marginTop={0}>
                    <Text bold color="red">Conflicts:</Text>
                    {request.conflicts.map((c, i) => (
                        <Text key={i} color="red">{"  • "}{c}</Text>
                    ))}
                </Box>
            )}

            <Text> </Text>

            {mode === "choose" ? (
                <Box>
                    <Text bold color="green">[A]</Text>
                    <Text>pprove  </Text>
                    <Text bold color="red">[D]</Text>
                    <Text>eny</Text>
                </Box>
            ) : (
                <Box>
                    <Text color="red" bold>Deny reason: </Text>
                    <TextInput
                        value={denyReason}
                        onChange={setDenyReason}
                        onSubmit={handleDenySubmit}
                        placeholder="Enter reason... (Esc to cancel)"
                    />
                </Box>
            )}
        </Box>
    );
}
