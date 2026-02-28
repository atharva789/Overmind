/**
 * Purpose: Fixed-width panel listing all party members and their status.
 *
 * High-level behavior: Renders a vertical list of members. Host is
 * prefixed with ★. Each member shows their username (truncated to fit)
 * and their current status on a second line, colored by status type.
 * Width is constrained to at least 16 columns.
 *
 * Assumptions:
 *  - members list reflects authoritative AppState; no local mutation.
 *
 * Invariants:
 *  - Prompt content is never displayed here.
 *  - Exactly one member in the list has isHost: true.
 */

import { Box, Text } from "ink";
import figures from "figures";

export type MemberStatus =
  | "idle"
  | "typing"
  | "queued"
  | "executing"
  | "reviewing";

export interface MemberView {
  username: string;
  isHost: boolean;
  status: MemberStatus;
}

interface PartyPanelProps {
  members: MemberView[];
  width: number;
}

const STATUS_COLOR: Record<MemberStatus, string> = {
  idle: "green",
  typing: "yellow",
  queued: "blue",
  executing: "cyan",
  reviewing: "magenta",
};

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function PartyPanel({ members, width }: PartyPanelProps) {
  const panelWidth = Math.max(width, 16);
  // Reserve space: 2 chars for prefix (★ or space + space)
  const nameMax = panelWidth - 4;

  return (
    <Box
      flexDirection="column"
      width={panelWidth}
      borderStyle="single"
      borderRight
      borderLeft={false}
      borderTop={false}
      borderBottom={false}
    >
      {members.map((m) => {
        const prefix = m.isHost ? figures.star : " ";
        const name = truncate(m.username, nameMax);
        const statusColor = STATUS_COLOR[m.status];
        return (
          <Box key={m.username} flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={m.isHost ? "magenta" : undefined} bold={m.isHost}>
                {prefix}{" "}
              </Text>
              <Text>{name}</Text>
            </Text>
            <Text color={statusColor}>{"  "}{m.status}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
