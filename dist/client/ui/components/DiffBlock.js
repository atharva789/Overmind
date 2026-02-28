import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
function lineColor(line) {
    if (line.startsWith("+"))
        return "green";
    if (line.startsWith("-"))
        return "red";
    if (line.startsWith("@@"))
        return "yellow";
    return undefined;
}
export function DiffBlock({ filename, diff }) {
    const lines = diff.split("\n");
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "single", children: [_jsx(Text, { bold: true, children: filename }), lines.map((line, i) => (_jsx(Text, { color: lineColor(line), children: line }, i)))] }));
}
//# sourceMappingURL=DiffBlock.js.map