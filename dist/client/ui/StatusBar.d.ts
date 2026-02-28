import React from "react";
interface StatusBarProps {
    partyCode: string;
    memberCount: number;
    connectionStatus: "connected" | "reconnecting" | "disconnected";
    executionBackendAvailable?: boolean;
    inviteCode?: string;
}
export default function StatusBar({ partyCode, memberCount, connectionStatus, executionBackendAvailable, inviteCode, }: StatusBarProps): React.ReactElement;
export {};
