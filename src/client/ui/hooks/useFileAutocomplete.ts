/**
 * useFileAutocomplete.ts
 *
 * Purpose: React hook providing @ file autocomplete logic for the
 *   prompt input. Detects when the user types `@` followed by a
 *   partial file path, filters project files by prefix match, and
 *   exposes cycling / acceptance controls.
 * Behavior: Parses the input value to find the last `@`-prefixed
 *   token. When active, provides a filtered suggestion list with
 *   a selected index that can be cycled via Tab and accepted via
 *   Enter.
 * Assumptions: The cursor is always at the end of the input value
 *   (ink-text-input does not expose cursor position).
 * Invariants: All state updates are immutable. The hook never
 *   mutates its arguments.
 */

import { useState, useMemo, useCallback } from "react";
import { listProjectFiles } from "../utils/file-list.js";

const MAX_SUGGESTIONS = 50;

export interface FileAutocompleteResult {
    readonly suggestions: readonly string[];
    readonly selectedIndex: number;
    readonly isActive: boolean;
    readonly accept: () => string;
    readonly cycle: () => void;
    readonly dismiss: () => void;
}

/**
 * Extract the partial file path after the last `@` in the input.
 * Returns null if no active `@` token is found.
 *
 * An `@` is considered active when:
 *   - It exists in the input
 *   - The character before it (if any) is a space or start of string
 *   - There is no space after the `@` before the cursor
 */
function extractAtPartial(inputValue: string): string | null {
    // Find the last `@` that starts a token
    let atIndex = -1;
    for (let idx = inputValue.length - 1; idx >= 0; idx--) {
        if (inputValue[idx] === "@") {
            // Must be at start of string or preceded by a space
            if (idx === 0 || inputValue[idx - 1] === " ") {
                atIndex = idx;
                break;
            }
        }
    }

    if (atIndex === -1) {
        return null;
    }

    const partial = inputValue.slice(atIndex + 1);

    // If the partial contains a space, the token is closed
    if (partial.includes(" ")) {
        return null;
    }

    return partial;
}

/**
 * Hook: useFileAutocomplete
 *
 * Provides file autocomplete suggestions based on the current
 * input value. Detects `@partial` tokens and filters the project
 * file list accordingly.
 *
 * Does not handle key events directly — the consuming component
 * calls `cycle()`, `accept()`, and `dismiss()` in response to
 * key presses.
 */
export function useFileAutocomplete(
    inputValue: string
): FileAutocompleteResult {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [dismissed, setDismissed] = useState<string | null>(null);

    const partial = extractAtPartial(inputValue);
    const isActive = partial !== null
        && partial !== dismissed;

    const suggestions = useMemo(() => {
        if (!isActive || partial === null) {
            return [];
        }

        const allFiles = listProjectFiles(process.cwd());
        const lowerPartial = partial.toLowerCase();

        const matched = allFiles.filter((filePath) =>
            filePath.toLowerCase().startsWith(lowerPartial)
        );

        return matched.slice(0, MAX_SUGGESTIONS);
    }, [isActive, partial]);

    const safeIndex = suggestions.length === 0
        ? 0
        : selectedIndex % suggestions.length;

    const cycle = useCallback(() => {
        if (suggestions.length === 0) return;
        setSelectedIndex((prev) =>
            (prev + 1) % suggestions.length
        );
    }, [suggestions.length]);

    const accept = useCallback((): string => {
        if (
            suggestions.length === 0 ||
            safeIndex >= suggestions.length
        ) {
            return inputValue;
        }

        const selected = suggestions[safeIndex];
        if (selected === undefined) {
            return inputValue;
        }

        const atIndex = inputValue.lastIndexOf("@");
        if (atIndex === -1) {
            return inputValue;
        }

        const before = inputValue.slice(0, atIndex);
        const newValue = `${before}@${selected} `;

        setSelectedIndex(0);
        setDismissed(null);

        return newValue;
    }, [inputValue, suggestions, safeIndex]);

    const dismiss = useCallback(() => {
        if (partial !== null) {
            setDismissed(partial);
        }
        setSelectedIndex(0);
    }, [partial]);

    return {
        suggestions,
        selectedIndex: safeIndex,
        isActive: isActive && suggestions.length > 0,
        accept,
        cycle,
        dismiss,
    };
}
