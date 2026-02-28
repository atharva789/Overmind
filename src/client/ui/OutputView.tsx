/**
 * Purpose: Displays prompt lifecycle outputs for the current user's
 * active prompt.
 *
 * High-level behavior: Filters state.outputs to only those belonging
 * to state.currentPromptId and renders the last N entries that fit.
 * When no prompt is active, shows a dim placeholder. Each entry is
 * prefixed with a colored Badge indicating its type.
 *
 * Assumptions:
 *  - outputs contains only entries for the local user's own prompts.
 *  - width is the available horizontal space after PartyPanel.
 *
 * Invariants:
 *  - Prompt content from other members is never rendered here.
 *  - At most MAX_VISIBLE entries are shown to avoid overflow.
 */

import { Box, Text } from "ink";
import { Badge } from "./components/Badge.js";
import { Spinner } from "./components/Spinner.js";

export interface OutputEntry {
  promptId: string;
  type:
    | "queued"
    | "greenlit"
    | "redlit"
    | "approved"
    | "denied"
    | "diff"
    | "complete"
    | "error";
  text: string;
  timestamp: number;
}

interface OutputViewProps {
  outputs: OutputEntry[];
  currentPromptId: string | null;
  width: number;
}

const MAX_VISIBLE = 12;

const BADGE_COLOR: Record<OutputEntry["type"], string> = {
  queued: "blue",
  greenlit: "green",
  redlit: "red",
  approved: "green",
  denied: "red",
  diff: "cyan",
  complete: "green",
  error: "red",
};

const PENDING_TYPES = new Set<OutputEntry["type"]>(["queued", "greenlit"]);

export function OutputView({
  outputs,
  currentPromptId,
  width: _width,
}: OutputViewProps) {
  if (!currentPromptId) {
    if (outputs.length === 0) {
      return (
        <Box flexGrow={1} paddingLeft={1}>
          <Text dimColor>No active prompt — type below to submit.</Text>
        </Box>
      );
    }
    // Show last entry of most recent prompt after it resolves
    const last = outputs[outputs.length - 1];
    if (!last) {
      return <Box flexGrow={1} />;
    }
    return (
      <Box flexGrow={1} flexDirection="column" paddingLeft={1}>
        <Text dimColor>Last result:</Text>
        <Box flexDirection="row" gap={1}>
          <Badge label={last.type} color={BADGE_COLOR[last.type]} />
          <Text>{last.text}</Text>
        </Box>
      </Box>
    );
  }

  const relevant = outputs
    .filter((o) => o.promptId === currentPromptId)
    .slice(-MAX_VISIBLE);

  const isStillPending =
    relevant.length === 0 ||
    PENDING_TYPES.has(relevant[relevant.length - 1]!.type);

  return (
    <Box flexGrow={1} flexDirection="column" paddingLeft={1}>
      {relevant.map((o, i) => (
        <Box key={i} flexDirection="row" gap={1}>
          <Badge label={o.type} color={BADGE_COLOR[o.type]} />
          <Text>{o.text}</Text>
        </Box>
      ))}
      {isStillPending && (
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text dimColor>Waiting…</Text>
        </Box>
      )}
    </Box>
  );
}
