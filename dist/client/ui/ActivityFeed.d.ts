import React from "react";
export interface ActivityEvent {
    username: string;
    event: string;
    timestamp: number;
}
interface ActivityFeedProps {
    events: readonly ActivityEvent[];
}
export default function ActivityFeed({ events }: ActivityFeedProps): React.ReactElement;
export {};
