import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Text, Box } from "ink";
export default function DiffBlock({ filename, diff }) {
    const lines = diff.split("\n");
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: _jsx(Text, { bold: true, color: "white", children: filename }) }), _jsx(Box, { flexDirection: "column", paddingLeft: 1, children: lines.map((line, i) => {
                    let color = "white";
                    if (line.startsWith("+"))
                        color = "green";
                    else if (line.startsWith("-"))
                        color = "red";
                    else if (line.startsWith("@@"))
                        color = "cyan";
                    return (_jsx(Text, { color: color, children: line }, i));
                }) })] }));
}
//# sourceMappingURL=DiffBlock.js.map