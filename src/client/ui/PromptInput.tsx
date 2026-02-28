// Purpose: Capture prompt input and emit submit/typing events.
// Behavior: Tracks idle/typing state and emits prompt submissions.
// Assumptions: Parent components handle prompt routing and validation.
// Invariants: Input state is local and cleared after submit.

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { nanoid } from "nanoid";

interface PromptInputProps {
    disabled: boolean;
    onSubmit: (promptId: string, content: string) => void;
    onTyping: () => void;
    onIdle: () => void;
}

export default function PromptInput({
    disabled,
    onSubmit,
    onTyping,
    onIdle,
}: PromptInputProps): React.ReactElement {
    const [value, setValue] = useState("");
    const idleTimer = useRef<NodeJS.Timeout | null>(null);
    const isTyping = useRef(false);

    const clearIdleTimer = useCallback(() => {
        if (idleTimer.current) {
            clearTimeout(idleTimer.current);
            idleTimer.current = null;
        }
    }, []);

    useEffect(() => {
        return () => clearIdleTimer();
    }, [clearIdleTimer]);

    const handleChange = useCallback(
        (newValue: string) => {
            setValue(newValue);

            if (!isTyping.current && newValue.length > 0) {
                isTyping.current = true;
                onTyping();
            }

            // Debounce idle signal — 1 second after last keystroke
            clearIdleTimer();
            idleTimer.current = setTimeout(() => {
                if (isTyping.current) {
                    isTyping.current = false;
                    onIdle();
                }
            }, 1000);
        },
        [onTyping, onIdle, clearIdleTimer]
    );

    const handleSubmit = useCallback(
        (input: string) => {
            const trimmed = input.trim();
            if (!trimmed || disabled) return;

            const promptId = nanoid(12);
            onSubmit(promptId, trimmed);
            setValue("");

            // Send idle right away after submit
            clearIdleTimer();
            if (isTyping.current) {
                isTyping.current = false;
                onIdle();
            }
        },
        [disabled, onSubmit, onIdle, clearIdleTimer]
    );

    if (disabled) {
        return (
            <Box paddingX={1}>
                <Text color="gray">{">"} </Text>
                <Text dimColor>Waiting for current prompt to complete...</Text>
            </Box>
        );
    }

    return (
        <Box paddingX={1}>
            <Text color="green" bold>
                {">"}{" "}
            </Text>
            <TextInput
                value={value}
                onChange={handleChange}
                onSubmit={handleSubmit}
                placeholder="Type a prompt... (/story to update story)"
            />
        </Box>
    );
}
