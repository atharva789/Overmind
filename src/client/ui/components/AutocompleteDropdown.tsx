/**
 * AutocompleteDropdown.tsx
 *
 * Purpose: Renders a dropdown list of file path suggestions above
 *   the prompt input for @ file autocomplete.
 * Behavior: Shows up to MAX_VISIBLE suggestions. The selected
 *   suggestion is highlighted in bold cyan. Directory portions of
 *   paths are dimmed; the filename portion is bright. A scroll
 *   indicator appears when there are more suggestions than visible.
 * Assumptions: Rendered inside a flex column layout, positioned
 *   above the input line by the parent component.
 * Invariants: Pure presentational component with no side effects.
 */

import React from "react";
import { Box, Text } from "ink";
import path from "node:path";

const MAX_VISIBLE = 8;

interface AutocompleteDropdownProps {
    readonly suggestions: readonly string[];
    readonly selectedIndex: number;
    readonly visible: boolean;
}

/**
 * Renders a single file path with the directory portion dimmed
 * and the filename bright. Selected items use bold cyan.
 */
function FileSuggestion({
    filePath,
    isSelected,
}: {
    readonly filePath: string;
    readonly isSelected: boolean;
}): React.ReactElement {
    const dirPart = path.dirname(filePath);
    const fileName = path.basename(filePath);
    const hasDir = dirPart !== ".";

    if (isSelected) {
        return (
            <Box>
                <Text bold color="cyan">
                    {" > "}
                    {hasDir ? `${dirPart}/` : ""}
                    {fileName}
                </Text>
            </Box>
        );
    }

    return (
        <Box>
            <Text>{"   "}</Text>
            {hasDir && <Text dimColor>{dirPart}/</Text>}
            <Text>{fileName}</Text>
        </Box>
    );
}

export default function AutocompleteDropdown({
    suggestions,
    selectedIndex,
    visible,
}: AutocompleteDropdownProps): React.ReactElement | null {
    if (!visible || suggestions.length === 0) {
        return null;
    }

    const totalCount = suggestions.length;
    const hasOverflow = totalCount > MAX_VISIBLE;

    // Calculate visible window centered around selected index
    let windowStart = 0;
    if (hasOverflow) {
        const halfWindow = Math.floor(MAX_VISIBLE / 2);
        windowStart = Math.max(
            0,
            Math.min(
                selectedIndex - halfWindow,
                totalCount - MAX_VISIBLE
            )
        );
    }

    const visibleSuggestions = suggestions.slice(
        windowStart,
        windowStart + MAX_VISIBLE
    );

    return (
        <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            marginLeft={2}
        >
            <Box>
                <Text dimColor>
                    Files ({totalCount} match
                    {totalCount !== 1 ? "es" : ""})
                </Text>
            </Box>
            {visibleSuggestions.map((suggestion, displayIdx) => {
                const actualIndex = windowStart + displayIdx;
                return (
                    <FileSuggestion
                        key={suggestion}
                        filePath={suggestion}
                        isSelected={actualIndex === selectedIndex}
                    />
                );
            })}
            {hasOverflow && (
                <Box>
                    <Text dimColor>
                        {"  "}[{windowStart + 1}-
                        {windowStart + visibleSuggestions.length}
                        {" of "}{totalCount}]
                    </Text>
                </Box>
            )}
        </Box>
    );
}
