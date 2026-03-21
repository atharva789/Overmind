import React from "react";
import { Box, Text } from "ink";
import Spinner from "./components/Spinner.js";
import DiffBlock from "./components/DiffBlock.js";
import type { FileChange } from "../../shared/protocol.js";

export interface TaskState {
    taskIndex: number;
    taskName: string;
    taskDescription: string;
    status: string;
    summary?: string;
    filesChanged?: string[];
}

export interface ToolActivity {
    toolName: string;
    phase: "start" | "result";
    success?: boolean;
    outputPreview?: string;
}

export interface ExecutionState {
    promptId: string;
    stage: string | null;
    files: FileChange[];
    summary: string | null;
    completed: boolean;
    tasks?: TaskState[];
    activeTools?: Record<number, ToolActivity>;
}

interface ExecutionViewProps {
    execution: ExecutionState;
}

const STAGE_ICONS: Record<string, string> = {
    "Acquiring file locks...": "🔒",
    "Syncing project files...": "📂",
    "Planning task decomposition...": "🧠",
    "Agents executing tasks...": "🤖",
    "Extracting changes...": "📋",
    "Applying changes to codebase...": "✏️",
};

const STATUS_ICON: Record<string, string> = {
    pending: "◯",
    spawned: "◉",
    working: "◉",
    finished: "✓",
};

function TaskPanel({ task, tool }: { task: TaskState; tool?: ToolActivity }): React.ReactElement {
    const icon = STATUS_ICON[task.status] ?? "◯";
    const isActive = task.status === "spawned" || task.status === "working";
    const isDone = task.status === "finished";

    return (
        <Box flexDirection="column" marginLeft={1} marginBottom={0}>
            <Box>
                {isActive ? <Spinner color="cyan" /> : <Text>{icon}</Text>}
                <Text bold={isActive} color={isDone ? "green" : isActive ? "cyan" : "gray"}>
                    {" "}{task.taskName}
                </Text>
            </Box>
            {tool && isActive && (
                <Box marginLeft={3}>
                    <Text dimColor>
                        {tool.phase === "start" ? "⚡" : tool.success ? "✓" : "✗"}{" "}
                        {tool.toolName}
                        {tool.outputPreview ? `: ${tool.outputPreview}` : ""}
                    </Text>
                </Box>
            )}
            {isDone && task.filesChanged && task.filesChanged.length > 0 && (
                <Box marginLeft={3}>
                    <Text dimColor>{task.filesChanged.length} file(s) changed</Text>
                </Box>
            )}
        </Box>
    );
}

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

    const hasTasks = execution.tasks && execution.tasks.length > 0;

    if (hasTasks) {
        const tasks = execution.tasks!;
        const doneCount = tasks.filter(t => t.status === "finished").length;

        return (
            <Box flexDirection="column" flexGrow={1} paddingX={1}>
                <Box>
                    <Spinner color="cyan" />
                    <Text bold color="cyan">
                        {" "}Executing: {tasks.length} agents ({doneCount}/{tasks.length} done)
                    </Text>
                </Box>
                <Text> </Text>
                {tasks.map((task) => (
                    <TaskPanel
                        key={task.taskIndex}
                        task={task}
                        tool={execution.activeTools?.[task.taskIndex]}
                    />
                ))}
                {execution.stage && (
                    <Box marginTop={1}>
                        <Text dimColor>{execution.stage}</Text>
                    </Box>
                )}
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
            <Spinner color="blue" label="Waiting for execution slot..." />
        </Box>
    );
}
