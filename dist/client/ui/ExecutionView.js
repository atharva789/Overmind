import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
import Spinner from "./components/Spinner.js";
import ScrollableBox from "./components/ScrollableBox.js";
const STAGE_ICONS = {
    "Acquiring file locks...": "🔒",
    "Syncing project files to sandbox...": "📂",
    "Spawning sandbox...": "📦",
    "Agent is working...": "🤖",
    "Extracting changes...": "📋",
    "Applying changes to codebase...": "✏️",
};
function buildDiffLines(files, summary) {
    const lines = [];
    lines.push(_jsx(Text, { bold: true, color: "green", children: "Execution Complete" }));
    lines.push(_jsx(Text, { children: " " }));
    for (const file of files) {
        // File header
        lines.push(_jsx(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: _jsx(Text, { bold: true, color: "white", children: file.path }) }));
        // Diff lines
        const diffLines = file.diff.split("\n");
        for (const line of diffLines) {
            let color = "white";
            if (line.startsWith("+"))
                color = "green";
            else if (line.startsWith("-"))
                color = "red";
            else if (line.startsWith("@@"))
                color = "cyan";
            lines.push(_jsxs(Text, { color: color, children: [" ", line] }));
        }
        lines.push(_jsx(Text, { children: " " }));
    }
    if (summary) {
        lines.push(_jsx(Text, { bold: true, children: summary }));
    }
    return lines;
}
export default function ExecutionView({ execution, focused = false, }) {
    const { stdout } = useStdout();
    const termHeight = stdout?.rows ?? 30;
    // Reserve space for StatusBar(1) + ActivityFeed(~7) + PromptInput(1) + borders
    const availableHeight = Math.max(termHeight - 10, 8);
    if (execution.completed && execution.summary) {
        const items = buildDiffLines(execution.files, execution.summary);
        return (_jsx(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: _jsx(ScrollableBox, { items: items, height: availableHeight, focused: focused }) }));
    }
    if (execution.stage) {
        const icon = STAGE_ICONS[execution.stage] ?? "⏳";
        return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: [_jsx(Text, { bold: true, color: "cyan", children: "Executing prompt..." }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsx(Spinner, { color: "cyan" }), _jsxs(Text, { children: [" ", icon, " ", execution.stage] })] })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: [_jsx(Text, { bold: true, color: "blue", children: "Queued for execution..." }), _jsx(Spinner, { color: "blue", label: "Waiting for sandbox slot..." })] }));
}
//# sourceMappingURL=ExecutionView.js.map