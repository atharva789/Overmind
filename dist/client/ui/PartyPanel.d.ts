import React from "react";
export interface MemberView {
    username: string;
    isHost: boolean;
    status: string;
}
interface PartyPanelProps {
    members: readonly MemberView[];
}
export default function PartyPanel({ members }: PartyPanelProps): React.ReactElement;
export {};
