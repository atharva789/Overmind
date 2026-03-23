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
import React from "react";
interface PromptInputProps {
    disabled: boolean;
    onSubmit: (promptId: string, content: string) => void;
    onTyping: () => void;
    onIdle: () => void;
}
export default function PromptInput({ disabled, onSubmit, onTyping, onIdle, }: PromptInputProps): React.ReactElement;
export {};
