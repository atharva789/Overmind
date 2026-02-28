import React from "react";
import { Text, Box } from "ink";

interface DiffBlockProps {
    filename: string;
    diff: string;
}

export default function DiffBlock({ filename, diff }: DiffBlockProps): React.ReactElement {
    const lines = diff.split("\n");

    return (
        <Box flexDirection="column">
            <Box borderStyle="single" borderColor="gray" paddingX={1}>
                <Text bold color="white">{filename}</Text>
            </Box>
            <Box flexDirection="column" paddingLeft={1}>
                {lines.map((line, i) => {
                    let color: string = "white";
                    if (line.startsWith("+")) color = "green";
                    else if (line.startsWith("-")) color = "red";
                    else if (line.startsWith("@@")) color = "cyan";

                    return (
                        <Text key={i} color={color}>
                            {line}
                        </Text>
                    );
                })}
            </Box>
        </Box>
    );
}
