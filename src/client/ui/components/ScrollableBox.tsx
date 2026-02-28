import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

interface ScrollableBoxProps {
    items: React.ReactNode[];
    height: number;
    focused?: boolean;
    autoScrollToEnd?: boolean;
}

const PAGE_SIZE = 10;

export default function ScrollableBox({
    items,
    height,
    focused = false,
    autoScrollToEnd = false,
}: ScrollableBoxProps): React.ReactElement {
    const totalItems = items.length;
    // Reserve 1 line for top indicator, 1 for bottom indicator
    const viewportHeight = Math.max(height - 2, 1);
    const maxOffset = Math.max(totalItems - viewportHeight, 0);

    const [scrollOffset, setScrollOffset] = useState(
        autoScrollToEnd ? maxOffset : 0
    );

    // Auto-scroll to end when new items arrive
    useEffect(() => {
        if (autoScrollToEnd) {
            setScrollOffset(maxOffset);
        }
    }, [autoScrollToEnd, maxOffset]);

    // Clamp offset when items or height change
    useEffect(() => {
        setScrollOffset((prev) => Math.min(prev, maxOffset));
    }, [maxOffset]);

    useInput(
        (_input, key) => {
            if (!focused) return;

            if (key.upArrow) {
                if (key.shift || key.meta) {
                    setScrollOffset((prev) => Math.max(prev - PAGE_SIZE, 0));
                } else {
                    setScrollOffset((prev) => Math.max(prev - 1, 0));
                }
            }

            if (key.downArrow) {
                if (key.shift || key.meta) {
                    setScrollOffset((prev) =>
                        Math.min(prev + PAGE_SIZE, maxOffset)
                    );
                } else {
                    setScrollOffset((prev) =>
                        Math.min(prev + 1, maxOffset)
                    );
                }
            }
        },
        { isActive: focused }
    );

    const hasAbove = scrollOffset > 0;
    const hasBelow = scrollOffset < maxOffset;
    const visible = items.slice(scrollOffset, scrollOffset + viewportHeight);

    return (
        <Box flexDirection="column" height={height}>
            {hasAbove ? (
                <Text dimColor>  ↑ {scrollOffset} more above</Text>
            ) : (
                <Text> </Text>
            )}

            <Box flexDirection="column" flexGrow={1}>
                {visible.map((item, i) => (
                    <Box key={scrollOffset + i}>{item}</Box>
                ))}
            </Box>

            {hasBelow ? (
                <Text dimColor>
                    {"  "}↓ {totalItems - scrollOffset - viewportHeight} more
                    below
                </Text>
            ) : (
                <Text> </Text>
            )}
        </Box>
    );
}
