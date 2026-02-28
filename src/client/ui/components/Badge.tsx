/**
 * Purpose: Inline colored label badge for prompt and status display.
 *
 * High-level behavior: Renders a bracketed label in the specified Ink
 * color. Used by OutputView to tag each output entry type.
 *
 * Assumptions:
 *  - color is a valid Ink/chalk color string (e.g. "green", "red").
 *
 * Invariants:
 *  - Renders as a single Text node; does not add newlines.
 */

import { Text } from "ink";

interface BadgeProps {
  label: string;
  color: string;
}

export function Badge({ label, color }: BadgeProps) {
  return <Text color={color}>[{label}]</Text>;
}
