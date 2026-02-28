import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
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
const STATUS_COLOR = {
    idle: "green",
    typing: "yellow",
    queued: "blue",
    executing: "cyan",
    reviewing: "magenta",
};
function truncate(s, max) {
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
export function PartyPanel({ members, width }) {
    const panelWidth = Math.max(width, 16);
    // Reserve space: 2 chars for prefix (★ or space + space)
    const nameMax = panelWidth - 4;
    return (_jsx(Box, { flexDirection: "column", width: panelWidth, borderStyle: "single", borderRight: true, borderLeft: false, borderTop: false, borderBottom: false, children: members.map((m) => {
            const prefix = m.isHost ? figures.star : " ";
            const name = truncate(m.username, nameMax);
            const statusColor = STATUS_COLOR[m.status];
            return (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Text, { children: [_jsxs(Text, { color: m.isHost ? "magenta" : undefined, bold: m.isHost, children: [prefix, " "] }), _jsx(Text, { children: name })] }), _jsxs(Text, { color: statusColor, children: ["  ", m.status] })] }, m.username));
        }) }));
}
//# sourceMappingURL=PartyPanel.js.map