import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
const STATUS_COLORS = {
    idle: "green",
    typing: "yellow",
    queued: "blue",
    "awaiting greenlight": "blue",
    "awaiting review": "magenta",
    executing: "cyan",
};
export default function PartyPanel({ members }) {
    const { stdout } = useStdout();
    const termWidth = stdout?.columns ?? 80;
    // Shrink width if terminal is small
    const panelWidth = termWidth < 60 ? 18 : 24;
    return (_jsxs(Box, { flexDirection: "column", width: panelWidth, borderStyle: "single", borderColor: "gray", paddingX: 1, children: [_jsx(Text, { bold: true, color: "white", children: "Members" }), members.map((member, idx) => {
                const prefix = member.isHost ? "★" : " ";
                const statusColor = STATUS_COLORS[member.status] ?? "gray";
                return (_jsxs(Text, { wrap: "truncate", children: [_jsxs(Text, { color: "gray", children: ["[", idx + 1, "]"] }), _jsx(Text, { color: "yellow", children: prefix }), _jsx(Text, { color: member.isHost ? "yellow" : "white", children: member.username }), _jsxs(Text, { color: statusColor, dimColor: true, children: [" (", member.status, ")"] })] }, member.username));
            })] }));
}
//# sourceMappingURL=PartyPanel.js.map