/**
 * PromptInput.tsx
 *
 * Purpose: Prompt input component for the Overmind TUI. Handles
 *   user text entry, typing/idle status signaling, and prompt
 *   submission. Integrates @ file autocomplete for referencing
 *   project files inline.
 * Behavior: Renders a text input with a prompt indicator. When
 *   the user types `@` followed by a partial path, an autocomplete
 *   dropdown appears above the input. Tab cycles suggestions,
 *   Enter accepts the selected suggestion, Escape dismisses.
 * Assumptions: Mounted inside an Ink application. The cursor is
 *   always at the end of the input (ink-text-input limitation).
 * Invariants: Typing/idle signals are always balanced. Prompt
 *   content is never leaked outside onSubmit.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { nanoid } from "nanoid";
import { useFileAutocomplete } from "./hooks/useFileAutocomplete.js";
import AutocompleteDropdown
    from "./components/AutocompleteDropdown.js";

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

    const autocomplete = useFileAutocomplete(value);

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

            // Debounce idle signal
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
            // When autocomplete is active, Enter accepts the
            // suggestion instead of submitting the prompt.
            if (autocomplete.isActive) {
                const newValue = autocomplete.accept();
                setValue(newValue);
                return;
            }

            const trimmed = input.trim();
            if (!trimmed) return;
            // Allow ! shell and / slash commands even when disabled
            if (
                disabled &&
                !trimmed.startsWith("!") &&
                !trimmed.startsWith("/")
            ) {
                return;
            }

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
        [
            disabled,
            onSubmit,
            onIdle,
            clearIdleTimer,
            autocomplete,
        ]
    );

    // Handle Tab for cycling and Escape for dismissal.
    // useInput receives keys that ink-text-input does not consume.
    useInput(
        useCallback(
            (
                _input: string,
                key: { tab?: boolean; escape?: boolean }
            ) => {
                if (key.tab && autocomplete.isActive) {
                    autocomplete.cycle();
                }
                if (key.escape && autocomplete.isActive) {
                    autocomplete.dismiss();
                }
            },
            [autocomplete]
        )
    );

    const promptColor = disabled ? "yellow" : "green";
    const placeholder = disabled
        ? "Executing... (! for shell commands)"
        : "Type a prompt... (@ for files)";

    return (
        <Box flexDirection="column">
            <AutocompleteDropdown
                suggestions={autocomplete.suggestions}
                selectedIndex={autocomplete.selectedIndex}
                visible={autocomplete.isActive}
            />
            <Box paddingX={1}>
                <Text color={promptColor} bold>
                    {">"}{" "}
                </Text>
                <TextInput
                    value={value}
                    onChange={handleChange}
                    onSubmit={handleSubmit}
                    placeholder={placeholder}
                />
            </Box>
        </Box>
    );
}
