import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { nanoid } from "nanoid";
export default function PromptInput({ disabled, onSubmit, onTyping, onIdle, }) {
    const [value, setValue] = useState("");
    const idleTimer = useRef(null);
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
    const handleChange = useCallback((newValue) => {
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
    }, [onTyping, onIdle, clearIdleTimer]);
    const handleSubmit = useCallback((input) => {
        const trimmed = input.trim();
        if (!trimmed || disabled)
            return;
        const promptId = nanoid(12);
        onSubmit(promptId, trimmed);
        setValue("");
        // Send idle right away after submit
        clearIdleTimer();
        if (isTyping.current) {
            isTyping.current = false;
            onIdle();
        }
    }, [disabled, onSubmit, onIdle, clearIdleTimer]);
    if (disabled) {
        return (_jsxs(Box, { paddingX: 1, children: [_jsxs(Text, { color: "gray", children: [">", " "] }), _jsx(Text, { dimColor: true, children: "Waiting for current prompt to complete..." })] }));
    }
    return (_jsxs(Box, { paddingX: 1, children: [_jsxs(Text, { color: "green", bold: true, children: [">", " "] }), _jsx(TextInput, { value: value, onChange: handleChange, onSubmit: handleSubmit, placeholder: "Type a prompt..." })] }));
}
//# sourceMappingURL=PromptInput.js.map