import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Box, Text, useStdout } from "ink";
import Spinner from "./components/Spinner.js";
import Badge from "./components/Badge.js";
const STATUS_CONFIG = {
    queued: { color: "blue", label: "QUEUED", dot: "○" },
    greenlit: { color: "green", label: "GREENLIT", dot: "●" },
    "feature-created": { color: "yellow", label: "NEW FEATURE", dot: "●" },
    redlit: { color: "red", label: "REDLIT", dot: "●" },
    approved: { color: "green", label: "APPROVED", dot: "●" },
    denied: { color: "red", label: "DENIED", dot: "●" },
    diff: { color: "cyan", label: "DIFF", dot: "◆" },
    complete: { color: "green", label: "COMPLETE", dot: "✓" },
    error: { color: "red", label: "ERROR", dot: "✕" },
};
function BlinkingVerdict({ entry }) {
    const [visible, setVisible] = React.useState(true);
    const [blinking, setBlinking] = React.useState(true);
    React.useEffect(() => {
        const blinkInterval = setInterval(() => {
            setVisible(v => !v);
        }, 500);
        const stopTimer = setTimeout(() => {
            setBlinking(false);
            setVisible(true);
            clearInterval(blinkInterval);
        }, 3000);
        return () => { clearInterval(blinkInterval); clearTimeout(stopTimer); };
    }, []);
    return (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsxs(Box, { children: [_jsx(Text, { color: "green", bold: true, dimColor: blinking && !visible, children: "\u25CF " }), _jsx(Text, { bold: true, dimColor: blinking && !visible, children: entry.message })] }), entry.promptContent && (_jsxs(Text, { color: "gray", dimColor: blinking && !visible, wrap: "truncate", children: ["  ", entry.promptContent] }))] }));
}
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
            const isVerdict = entry.status === "greenlit" || entry.status === "redlit" || entry.status === "feature-created";
            if (isVerdict && (entry.status === "feature-created" || entry.status === "greenlit")) {
                return _jsx(BlinkingVerdict, { entry: entry }, entry.id);
            }
            if (isVerdict && entry.promptContent) {
                // Show prompt text with colored dot for other verdicts (redlit)
                return (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsxs(Box, { children: [_jsxs(Text, { color: config.color, bold: true, children: [config.dot, " "] }), _jsx(Text, { wrap: "truncate", children: entry.promptContent })] }), _jsxs(Text, { color: "gray", wrap: "truncate", children: ["  ", entry.message] })] }, entry.id));
            }
            return (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsxs(Box, { children: [_jsx(Badge, { label: config.label, color: config.color }), isActive && _jsx(Spinner, { color: "blue" })] }), _jsxs(Text, { color: "gray", wrap: "truncate", children: ["  ", entry.message] })] }, entry.id));
        }) }));
}
//# sourceMappingURL=OutputView.js.map