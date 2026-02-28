import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
function formatTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}
function truncateLine(s, max) {
    return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
export function ActivityFeed({ events, width }) {
    const visible = events.slice(-5);
    const separator = "─".repeat(Math.max(width, 1));
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { dimColor: true, children: separator }), visible.map((e, i) => {
                const line = `${formatTime(e.timestamp)}  ${e.username}  ${e.event}`;
                return (_jsx(Text, { dimColor: true, children: truncateLine(line, width - 1) }, i));
            }), visible.length === 0 && (_jsx(Text, { dimColor: true, children: "No activity yet." }))] }));
}
//# sourceMappingURL=ActivityFeed.js.map