import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import Spinner from "./components/Spinner.js";
import DiffBlock from "./components/DiffBlock.js";
const STAGE_ICONS = {
    "Acquiring file locks...": "🔒",
    "Syncing project files to sandbox...": "📂",
    "Spawning sandbox...": "📦",
    "Agent is working...": "🤖",
    "Extracting changes...": "📋",
    "Applying changes to codebase...": "✏️",
};
export default function ExecutionView({ execution, }) {
    if (execution.completed && execution.summary) {
        return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: [_jsx(Text, { bold: true, color: "green", children: "\u2713 Execution Complete" }), _jsx(Text, { children: " " }), execution.files.map((file, i) => (_jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsx(DiffBlock, { filename: file.path, diff: file.diff }) }, i))), _jsx(Text, { children: " " }), _jsx(Text, { bold: true, children: execution.summary })] }));
    }
    if (execution.stage) {
        const icon = STAGE_ICONS[execution.stage] ?? "⏳";
        return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: [_jsx(Text, { bold: true, color: "cyan", children: "Executing prompt..." }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsx(Spinner, { color: "cyan" }), _jsxs(Text, { children: [" ", icon, " ", execution.stage] })] })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, children: [_jsx(Text, { bold: true, color: "blue", children: "Queued for execution..." }), _jsx(Spinner, { color: "blue", label: "Waiting for sandbox slot..." })] }));
}
//# sourceMappingURL=ExecutionView.js.map