/**
 * Purpose: Single-line prompt input with debounced typing status.
 *
 * High-level behavior: Renders a green `> ` prefix followed by a
 * controlled TextInput. Disabled when a prompt is already in flight
 * (currentPromptId != null). On change, fires onStatusChange("typing")
 * once per typing burst and schedules onStatusChange("idle") after 1 s
 * of inactivity. On submit, generates a nanoid promptId, calls
 * onSubmit, and clears the input.
 *
 * Assumptions:
 *  - onSubmit and onStatusChange are stable callback references.
 *  - nanoid(12) produces sufficient uniqueness for promptIds.
 *
 * Invariants:
 *  - Typing status updates are debounced to avoid spamming the server.
 *  - Submission is ignored when disabled or when input is empty.
 *  - Idle timer is always cleared on unmount.
 */

import { useState, useRef, useEffect } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { nanoid } from "nanoid";

interface PromptInputProps {
  disabled: boolean;
  onSubmit: (content: string, promptId: string) => void;
  onStatusChange: (status: "typing" | "idle") => void;
  width: number;
}

const IDLE_DEBOUNCE_MS = 1000;

export function PromptInput({
  disabled,
  onSubmit,
  onStatusChange,
  width: _width,
}: PromptInputProps) {
  const [value, setValue] = useState("");
  const isTypingRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the idle timer on unmount to prevent leaks.
  useEffect(() => {
    return () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  function handleChange(newValue: string): void {
    setValue(newValue);

    // Send "typing" once at the leading edge of each burst.
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      onStatusChange("typing");
    }

    // Reset idle countdown on every keystroke.
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      isTypingRef.current = false;
      onStatusChange("idle");
    }, IDLE_DEBOUNCE_MS);
  }

  function handleSubmit(submitted: string): void {
    if (disabled || !submitted.trim()) return;

    // Cancel pending idle timer — we're done with this burst.
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    isTypingRef.current = false;
    onStatusChange("idle");

    const promptId = nanoid(12);
    onSubmit(submitted.trim(), promptId);
    setValue("");
  }

  return (
    <Box flexDirection="row">
      <Text color="green">{"> "}</Text>
      <TextInput
        value={value}
        onChange={handleChange}
        onSubmit={handleSubmit}
        placeholder={disabled ? "Waiting for response…" : "Enter prompt…"}
        focus={!disabled}
      />
    </Box>
  );
}
