import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
export default function StatusBar({ partyCode, memberCount, connectionStatus, greenlightAvailable = true, executionBackendAvailable = true, inviteCode, }) {
    const { stdout } = useStdout();
    const width = stdout?.columns ?? 80;
    const dot = "●";
    const dotColor = connectionStatus === "connected"
        ? "green"
        : connectionStatus === "reconnecting"
            ? "yellow"
            : "red";
    const statusLabel = connectionStatus === "connected"
        ? "Live"
        : connectionStatus === "reconnecting"
            ? "Reconnecting"
            : "Disconnected";
    const warnings = [];
    if (!greenlightAvailable)
        warnings.push("⚠ Greenlight unavailable");
    if (!executionBackendAvailable)
        warnings.push("⚠ Execution offline");
    const inviteLabel = inviteCode ? `Invite: ${inviteCode} · ` : "";
    const content = `OVERMIND · Party: ${partyCode} · ` +
        `${memberCount} member${memberCount !== 1 ? "s" : ""} · ` +
        inviteLabel;
    const maxLen = Math.max(width - 20, 30);
    const truncated = content.length > maxLen ? content.slice(0, maxLen) + "…" : content;
    return (_jsxs(Box, { width: width, borderStyle: "single", borderTop: false, borderLeft: false, borderRight: false, borderBottom: true, borderColor: "gray", paddingX: 1, children: [_jsx(Text, { bold: true, color: "cyan", children: truncated }), _jsx(Text, { color: dotColor, children: dot }), _jsxs(Text, { children: [" ", statusLabel] }), warnings.length > 0 && (_jsxs(Text, { color: "yellow", children: [" ", warnings.join(" · ")] }))] }));
}
//# sourceMappingURL=StatusBar.js.map