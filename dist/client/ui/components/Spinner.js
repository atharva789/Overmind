import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Text } from "ink";
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export default function Spinner({ color = "cyan", label }) {
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => {
            setFrame((prev) => (prev + 1) % FRAMES.length);
        }, 80);
        return () => clearInterval(timer);
    }, []);
    return (_jsxs(Text, { children: [_jsx(Text, { color: color, children: FRAMES[frame] }), label ? _jsxs(Text, { children: [" ", label] }) : null] }));
}
//# sourceMappingURL=Spinner.js.map