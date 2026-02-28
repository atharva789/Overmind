/**
 * Purpose: Dim event log showing the last 5 party activity events.
 *
 * High-level behavior: Renders events in "HH:MM  username  event"
 * format, dimmed. Shows at most 5 entries. Lines that exceed the
 * terminal width are truncated. No scrolling is provided.
 *
 * Assumptions:
 *  - events array contains at most 5 entries (enforced by reducer).
 *  - Prompt content is never present in event strings.
 *
 * Invariants:
 *  - Never renders more than 5 entries.
 *  - No prompt content is ever displayed.
 */

import { Box, Text } from "ink";

export interface ActivityEvent {
  username: string;
  event: string;
  timestamp: number;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  width: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function truncateLine(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function ActivityFeed({ events, width }: ActivityFeedProps) {
  const visible = events.slice(-5);
  const separator = "─".repeat(Math.max(width, 1));

  return (
    <Box flexDirection="column">
      <Text dimColor>{separator}</Text>
      {visible.map((e, i) => {
        const line = `${formatTime(e.timestamp)}  ${e.username}  ${e.event}`;
        return (
          <Text key={i} dimColor>
            {truncateLine(line, width - 1)}
          </Text>
        );
      })}
      {visible.length === 0 && (
        <Text dimColor>No activity yet.</Text>
      )}
    </Box>
  );
}
