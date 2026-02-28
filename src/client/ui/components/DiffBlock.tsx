/**
 * Purpose: Renders a colored unified diff block in the terminal.
 *
 * High-level behavior: Accepts a filename and a diff string. Splits
 * into lines and colors them: + lines green, - lines red, @@ hunk
 * headers yellow, context lines white. Wraps the block in a box with
 * a single border and a bold filename header.
 *
 * Assumptions:
 *  - diff is a standard unified diff string (Phase 2: mock only).
 *  - Collapsing and interactive navigation are not implemented yet.
 *
 * Invariants:
 *  - Prompt content is never rendered; only diffs are displayed here.
 *  - Line count may be large; caller is responsible for visibility.
 */

import { Box, Text } from "ink";

interface DiffBlockProps {
  filename: string;
  diff: string;
}

function lineColor(line: string): string | undefined {
  if (line.startsWith("+")) return "green";
  if (line.startsWith("-")) return "red";
  if (line.startsWith("@@")) return "yellow";
  return undefined;
}

export function DiffBlock({ filename, diff }: DiffBlockProps) {
  const lines = diff.split("\n");

  return (
    <Box flexDirection="column" borderStyle="single">
      <Text bold>{filename}</Text>
      {lines.map((line, i) => (
        <Text key={i} color={lineColor(line)}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
