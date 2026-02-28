import React from "react";
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
export default function ExecutionView({ execution, focused, }: ExecutionViewProps): React.ReactElement;
export {};
