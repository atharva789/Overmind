import { jsx as _jsx } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
const MAX_EVENTS = 5;
function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export default function ActivityFeed({ events }) {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;
    const visible = events.slice(-MAX_EVENTS);
    if (visible.length === 0) {
        return (_jsx(Box, { paddingX: 1, children: _jsx(Text, { dimColor: true, children: "No activity yet." }) }));
    }
    return (_jsx(Box, { flexDirection: "column", paddingX: 1, children: visible.map((evt, i) => {
            const line = `${formatTime(evt.timestamp)}  ${evt.username} ${evt.event}`;
            // Truncate if it overflows
            const maxLen = Math.max(width - 4, 20);
            const display = line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;
            return (_jsx(Text, { dimColor: true, wrap: "truncate", children: display }, i));
        }) }));
}
//# sourceMappingURL=ActivityFeed.js.map