import React from "react";
import { Text, Box } from "ink";

interface DiffBlockProps {
    filename: string;
    diff: string;
}

const MAX_PATH_WIDTH = 70;

function truncatePath(path: string, maxWidth: number): string {
    if (path.length <= maxWidth) return path;
    const parts = path.split("/");
    if (parts.length <= 2) return "..." + path.slice(-(maxWidth - 3));
    // Keep first dir + filename, truncate middle
    const first = parts[0];
    const last = parts[parts.length - 1];
    return `${first}/.../${last}`;
}

export default function DiffBlock({ filename, diff }: DiffBlockProps): React.ReactElement {
    const lines = diff.split("\n").filter((l) => l.length > 0);
    const displayPath = truncatePath(filename, MAX_PATH_WIDTH);

    // Count additions/removals for summary
    const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
    const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

    // Show max 20 lines collapsed, rest indicated
    const maxLines = 20;
    const truncated = lines.length > maxLines;
    const visibleLines = truncated ? lines.slice(0, maxLines) : lines;

    return (
        <Box flexDirection="column" marginY={0}>
            <Box>
                <Text dimColor>{"─"}</Text>
                <Text bold color="white" wrap="truncate">{displayPath}</Text>
                <Text dimColor> (+{added}/-{removed})</Text>
            </Box>
            <Box flexDirection="column" paddingLeft={2}>
                {visibleLines.map((line, i) => {
                    let color: string = "gray";
                    if (line.startsWith("+")) color = "green";
                    else if (line.startsWith("-")) color = "red";
                    else if (line.startsWith("@@")) color = "cyan";

                    return (
                        <Text key={i} color={color} wrap="truncate">
                            {line}
                        </Text>
                    );
                })}
                {truncated && (
                    <Text dimColor italic>
                        {"  "}... {lines.length - maxLines} more lines
                    </Text>
                )}
            </Box>
        </Box>
    );
}
