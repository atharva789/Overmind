import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
import Spinner from "./components/Spinner.js";
import Badge from "./components/Badge.js";
const STATUS_CONFIG = {
    queued: { color: "blue", label: "QUEUED", dot: "○" },
    greenlit: { color: "green", label: "GREENLIT", dot: "●" },
    redlit: { color: "red", label: "REDLIT", dot: "●" },
    approved: { color: "green", label: "APPROVED", dot: "●" },
    denied: { color: "red", label: "DENIED", dot: "●" },
    diff: { color: "cyan", label: "DIFF", dot: "◆" },
    complete: { color: "green", label: "COMPLETE", dot: "✓" },
    error: { color: "red", label: "ERROR", dot: "✕" },
};
const MAX_VISIBLE = 20;
export default function OutputView({ outputs, currentPromptId, }) {
    const { stdout } = useStdout();
    const height = stdout?.rows ?? 30;
    // Only show outputs for the current prompt
    const filtered = currentPromptId
        ? outputs.filter((o) => o.promptId === currentPromptId)
        : [];
    // Show last N entries based on available space
    const maxItems = Math.min(MAX_VISIBLE, Math.max(height - 10, 3));
    const visible = filtered.slice(-maxItems);
    if (visible.length === 0) {
        return (_jsx(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: _jsx(Text, { dimColor: true, children: "No active prompt. Type a prompt below to get started." }) }));
    }
    return (_jsx(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: visible.map((entry) => {
            const config = STATUS_CONFIG[entry.status];
            const isActive = entry.status === "queued";
            const isVerdict = entry.status === "greenlit" || entry.status === "redlit";
            if (isVerdict && entry.promptContent) {
                // Show prompt text with colored dot for verdicts
                return (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsxs(Box, { children: [_jsxs(Text, { color: config.color, bold: true, children: [config.dot, " "] }), _jsx(Text, { wrap: "truncate", children: entry.promptContent })] }), _jsxs(Text, { color: "gray", wrap: "truncate", children: ["  ", entry.message] })] }, entry.id));
            }
            return (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsxs(Box, { children: [_jsx(Badge, { label: config.label, color: config.color }), isActive && _jsx(Spinner, { color: "blue" })] }), _jsxs(Text, { color: "gray", wrap: "truncate", children: ["  ", entry.message] })] }, entry.id));
        }) }));
}
//# sourceMappingURL=OutputView.js.map