import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
export default function ReviewPanel({ request, onApprove, onDeny, }) {
    const [mode, setMode] = useState("choose");
    const [denyReason, setDenyReason] = useState("");
    useInput(useCallback((input, key) => {
        if (mode === "choose") {
            if (input === "a" || input === "A") {
                onApprove(request.promptId);
            }
            else if (input === "d" || input === "D") {
                setMode("deny");
            }
        }
        else if (mode === "deny") {
            if (key.escape) {
                setMode("choose");
                setDenyReason("");
            }
        }
    }, [mode, request.promptId, onApprove]));
    const handleDenySubmit = useCallback((value) => {
        const trimmed = value.trim();
        if (trimmed) {
            onDeny(request.promptId, trimmed);
            setDenyReason("");
            setMode("choose");
        }
    }, [request.promptId, onDeny]);
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "double", borderColor: "magenta", paddingX: 1, paddingY: 0, children: [_jsx(Text, { bold: true, color: "magenta", children: "\u26A0 Host Review Required" }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsx(Text, { bold: true, children: "From: " }), _jsx(Text, { color: "cyan", children: request.username })] }), _jsxs(Box, { flexDirection: "column", marginTop: 0, children: [_jsx(Text, { bold: true, children: "Prompt:" }), _jsxs(Text, { color: "white", wrap: "wrap", children: ["  ", request.content] })] }), request.reasoning && (_jsxs(Box, { flexDirection: "column", marginTop: 0, children: [_jsx(Text, { bold: true, children: "Agent reasoning:" }), _jsxs(Text, { color: "yellow", dimColor: true, wrap: "wrap", children: ["  ", request.reasoning] })] })), request.conflicts.length > 0 && (_jsxs(Box, { flexDirection: "column", marginTop: 0, children: [_jsx(Text, { bold: true, color: "red", children: "Conflicts:" }), request.conflicts.map((c, i) => (_jsxs(Text, { color: "red", children: ["  • ", c] }, i)))] })), _jsx(Text, { children: " " }), mode === "choose" ? (_jsxs(Box, { children: [_jsx(Text, { bold: true, color: "green", children: "[A]" }), _jsx(Text, { children: "pprove  " }), _jsx(Text, { bold: true, color: "red", children: "[D]" }), _jsx(Text, { children: "eny" })] })) : (_jsxs(Box, { children: [_jsx(Text, { color: "red", bold: true, children: "Deny reason: " }), _jsx(TextInput, { value: denyReason, onChange: setDenyReason, onSubmit: handleDenySubmit, placeholder: "Enter reason... (Esc to cancel)" })] }))] }));
}
//# sourceMappingURL=ReviewPanel.js.map