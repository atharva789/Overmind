import { jsx as _jsx } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
import ScrollableBox from "./components/ScrollableBox.js";
const FEED_HEIGHT = 7;
function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export default function ActivityFeed({ events, focused = false }) {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;
    if (events.length === 0) {
        return (_jsx(Box, { paddingX: 1, height: 3, children: _jsx(Text, { dimColor: true, children: "No activity yet." }) }));
    }
    const items = events.map((evt, i) => {
        const line = `${formatTime(evt.timestamp)}  ${evt.username} ${evt.event}`;
        const maxLen = Math.max(width - 4, 20);
        const display = line.length > maxLen ? line.slice(0, maxLen - 1) + "…" : line;
        return (_jsx(Text, { dimColor: true, wrap: "truncate", children: display }, i));
    });
    return (_jsx(Box, { flexDirection: "column", paddingX: 1, borderStyle: focused ? "single" : undefined, borderColor: focused ? "cyan" : undefined, children: _jsx(ScrollableBox, { items: items, height: FEED_HEIGHT, focused: focused, autoScrollToEnd: true }) }));
}
//# sourceMappingURL=ActivityFeed.js.map