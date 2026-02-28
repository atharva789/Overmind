import { jsx as _jsx } from "react/jsx-runtime";
import { Text } from "ink";
export default function Badge({ label, color }) {
    return (_jsx(Text, { color: color, bold: true, children: ` ${label.toUpperCase()} ` }));
}
//# sourceMappingURL=Badge.js.map