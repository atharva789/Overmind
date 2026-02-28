import React from "react";
interface StatusBarProps {
    partyCode: string;
    memberCount: number;
    connectionStatus: "connected" | "reconnecting" | "disconnected";
    greenlightAvailable?: boolean;
    executionBackendAvailable?: boolean;
    inviteCode?: string;
}
export default function StatusBar({ partyCode, memberCount, connectionStatus, greenlightAvailable, executionBackendAvailable, inviteCode, }: StatusBarProps): React.ReactElement;
export {};
