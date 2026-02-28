import React from "react";
export interface ReviewRequest {
    promptId: string;
    username: string;
    content: string;
    reasoning: string;
    conflicts: string[];
}
interface ReviewPanelProps {
    request: ReviewRequest;
    onApprove: (promptId: string) => void;
    onDeny: (promptId: string, reason: string) => void;
}
export default function ReviewPanel({ request, onApprove, onDeny, }: ReviewPanelProps): React.ReactElement;
export {};
