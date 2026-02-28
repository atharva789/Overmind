import React from "react";
import { Box, Text } from "ink";
import Spinner from "./components/Spinner.js";
import DiffBlock from "./components/DiffBlock.js";
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
}

const STAGE_ICONS: Record<string, string> = {
    "Acquiring file locks...": "🔒",
    "Syncing project files to sandbox...": "📂",
    "Spawning sandbox...": "📦",
    "Agent is working...": "🤖",
    "Extracting changes...": "📋",
    "Applying changes to codebase...": "✏️",
};

export default function ExecutionView({
    execution,
}: ExecutionViewProps): React.ReactElement {
    if (execution.completed && execution.summary) {
        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <Text bold color="green">✓ Execution Complete</Text>
                <Text> </Text>

                {execution.files.map((file, i) => (
                    <Box key={i} flexDirection="column" marginBottom={1}>
                        <DiffBlock filename={file.path} diff={file.diff} />
                    </Box>
                ))}

                <Text> </Text>
                <Text bold>{execution.summary}</Text>
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
