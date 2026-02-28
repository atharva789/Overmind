/**
 * Purpose: Single-row status bar showing party info and connection state.
 *
 * High-level behavior: Renders "OVERMIND · Party: XXXX · N members · ●
 * Live/Reconnecting/Offline" on one line followed by a separator. The
 * dot color reflects connection status. Gracefully truncates when the
 * terminal is too narrow.
 *
 * Assumptions:
 *  - props.width reflects the current terminal column count.
 *
 * Invariants:
 *  - Always renders as exactly two lines (content + separator).
 *  - Never logs or leaks prompt content.
 */

import { Box, Text } from "ink";
import figures from "figures";

interface StatusBarProps {
  partyCode: string;
  memberCount: number;
  connectionStatus: "connected" | "reconnecting" | "disconnected";
  width: number;
}

const DOT_COLOR: Record<StatusBarProps["connectionStatus"], string> = {
  connected: "green",
  reconnecting: "yellow",
  disconnected: "red",
};

const STATUS_LABEL: Record<StatusBarProps["connectionStatus"], string> = {
  connected: "Live",
  reconnecting: "Reconnecting",
  disconnected: "Offline",
};

export function StatusBar({
  partyCode,
  memberCount,
  connectionStatus,
  width,
}: StatusBarProps) {
  const dot = figures.bullet;
  const dotColor = DOT_COLOR[connectionStatus];
  const label = STATUS_LABEL[connectionStatus];
  const codeDisplay = partyCode || "----";
  const separator = "─".repeat(Math.max(width, 1));

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold>OVERMIND</Text>
        <Text> · Party: </Text>
        <Text bold color="cyan">
          {codeDisplay}
        </Text>
        <Text> · {memberCount} member{memberCount !== 1 ? "s" : ""} · </Text>
        <Text color={dotColor}>{dot} </Text>
        <Text color={dotColor}>{label}</Text>
      </Box>
      <Text dimColor>{separator}</Text>
    </Box>
  );
}
