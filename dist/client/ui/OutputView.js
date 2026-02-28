import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Purpose: Displays prompt lifecycle outputs for the current user's
 * active prompt.
 *
 * High-level behavior: Filters state.outputs to only those belonging
 * to state.currentPromptId and renders the last N entries that fit.
 * When no prompt is active, shows a dim placeholder. Each entry is
 * prefixed with a colored Badge indicating its type.
 *
 * Assumptions:
 *  - outputs contains only entries for the local user's own prompts.
 *  - width is the available horizontal space after PartyPanel.
 *
 * Invariants:
 *  - Prompt content from other members is never rendered here.
 *  - At most MAX_VISIBLE entries are shown to avoid overflow.
 */
import { Box, Text } from "ink";
import { Badge } from "./components/Badge.js";
import { Spinner } from "./components/Spinner.js";
const MAX_VISIBLE = 12;
const BADGE_COLOR = {
    queued: "blue",
    greenlit: "green",
    redlit: "red",
    approved: "green",
    denied: "red",
    diff: "cyan",
    complete: "green",
    error: "red",
};
const PENDING_TYPES = new Set(["queued", "greenlit"]);
export function OutputView({ outputs, currentPromptId, width: _width, }) {
    if (!currentPromptId) {
        if (outputs.length === 0) {
            return (_jsx(Box, { flexGrow: 1, paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: "No active prompt \u2014 type below to submit." }) }));
        }
        // Show last entry of most recent prompt after it resolves
        const last = outputs[outputs.length - 1];
        if (!last) {
            return _jsx(Box, { flexGrow: 1 });
        }
        return (_jsxs(Box, { flexGrow: 1, flexDirection: "column", paddingLeft: 1, children: [_jsx(Text, { dimColor: true, children: "Last result:" }), _jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Badge, { label: last.type, color: BADGE_COLOR[last.type] }), _jsx(Text, { children: last.text })] })] }));
    }
    const relevant = outputs
        .filter((o) => o.promptId === currentPromptId)
        .slice(-MAX_VISIBLE);
    const isStillPending = relevant.length === 0 ||
        PENDING_TYPES.has(relevant[relevant.length - 1].type);
    return (_jsxs(Box, { flexGrow: 1, flexDirection: "column", paddingLeft: 1, children: [relevant.map((o, i) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Badge, { label: o.type, color: BADGE_COLOR[o.type] }), _jsx(Text, { children: o.text })] }, i))), isStillPending && (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Spinner, {}), _jsx(Text, { dimColor: true, children: "Waiting\u2026" })] }))] }));
}
//# sourceMappingURL=OutputView.js.map