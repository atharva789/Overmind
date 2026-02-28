import React from "react";
export type OutputStatus = "queued" | "greenlit" | "redlit" | "approved" | "denied" | "diff" | "complete" | "error";
export interface OutputEntry {
    id: string;
    promptId: string;
    status: OutputStatus;
    message: string;
    timestamp: number;
}
interface OutputViewProps {
    outputs: OutputEntry[];
    currentPromptId: string | null;
}
export default function OutputView({ outputs, currentPromptId, }: OutputViewProps): React.ReactElement;
export {};
