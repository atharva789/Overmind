import React from "react";
import { Box, Text, useStdout } from "ink";
import Spinner from "./components/Spinner.js";
import ScrollableBox from "./components/ScrollableBox.js";
import type { FileChange } from "../../shared/protocol.js";

export interface ExecutionState {
    promptId: string;
    stage: string | null;
    files: FileChange[];
    summary: string | null;
    completed: boolean;
}

interface ExecutionViewProps {
    execution: ExecutionState;
    focused?: boolean;
}

const STAGE_ICONS: Record<string, string> = {
    "Acquiring file locks...": "🔒",
    "Syncing project files to sandbox...": "📂",
    "Spawning sandbox...": "📦",
    "Agent is working...": "🤖",
    "Extracting changes...": "📋",
    "Applying changes to codebase...": "✏️",
};

function buildDiffLines(files: FileChange[], summary: string | null): React.ReactNode[] {
    const lines: React.ReactNode[] = [];

    lines.push(
        <Text bold color="green">Execution Complete</Text>
    );
    lines.push(<Text> </Text>);

    for (const file of files) {
        // File header
        lines.push(
            <Box borderStyle="single" borderColor="gray" paddingX={1}>
                <Text bold color="white">{file.path}</Text>
            </Box>
        );

        // Diff lines
        const diffLines = file.diff.split("\n");
        for (const line of diffLines) {
            let color: string = "white";
            if (line.startsWith("+")) color = "green";
            else if (line.startsWith("-")) color = "red";
            else if (line.startsWith("@@")) color = "cyan";

            lines.push(<Text color={color}> {line}</Text>);
        }

        lines.push(<Text> </Text>);
    }

    if (summary) {
        lines.push(<Text bold>{summary}</Text>);
    }

    return lines;
}

export default function ExecutionView({
    execution,
    focused = false,
}: ExecutionViewProps): React.ReactElement {
    const { stdout } = useStdout();
    const termHeight = stdout?.rows ?? 30;
    // Reserve space for StatusBar(1) + ActivityFeed(~7) + PromptInput(1) + borders
    const availableHeight = Math.max(termHeight - 10, 8);

    if (execution.completed && execution.summary) {
        const items = buildDiffLines(execution.files, execution.summary);

        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <ScrollableBox
                    items={items}
                    height={availableHeight}
                    focused={focused}
                />
            </Box>
        );
    }

    if (execution.stage) {
        const icon = STAGE_ICONS[execution.stage] ?? "⏳";
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <Text bold color="cyan">Executing prompt...</Text>
                <Text> </Text>
                <Box>
                    <Spinner color="cyan" />
                    <Text> {icon} {execution.stage}</Text>
                </Box>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
            <Text bold color="blue">Queued for execution...</Text>
            <Spinner color="blue" label="Waiting for sandbox slot..." />
        </Box>
    );
}
