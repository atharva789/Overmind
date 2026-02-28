import React from "react";
export interface ActivityEvent {
    username: string;
    event: string;
    timestamp: number;
}
interface ActivityFeedProps {
    events: ActivityEvent[];
    focused?: boolean;
}
export default function ActivityFeed({ events, focused }: ActivityFeedProps): React.ReactElement;
export {};
