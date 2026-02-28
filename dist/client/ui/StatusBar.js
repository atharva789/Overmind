import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const DOT_COLOR = {
    connected: "green",
    reconnecting: "yellow",
    disconnected: "red",
};
const STATUS_LABEL = {
    connected: "Live",
    reconnecting: "Reconnecting",
    disconnected: "Offline",
};
export function StatusBar({ partyCode, memberCount, connectionStatus, width, }) {
    const dot = figures.bullet;
    const dotColor = DOT_COLOR[connectionStatus];
    const label = STATUS_LABEL[connectionStatus];
    const codeDisplay = partyCode || "----";
    const separator = "─".repeat(Math.max(width, 1));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { bold: true, children: "OVERMIND" }), _jsx(Text, { children: " \u00B7 Party: " }), _jsx(Text, { bold: true, color: "cyan", children: codeDisplay }), _jsxs(Text, { children: [" \u00B7 ", memberCount, " member", memberCount !== 1 ? "s" : "", " \u00B7 "] }), _jsxs(Text, { color: dotColor, children: [dot, " "] }), _jsx(Text, { color: dotColor, children: label })] }), _jsx(Text, { dimColor: true, children: separator })] }));
}
//# sourceMappingURL=StatusBar.js.map