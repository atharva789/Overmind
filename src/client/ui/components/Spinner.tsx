import React, { useState, useEffect } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
    color?: string;
    label?: string;
}

export default function Spinner({ color = "cyan", label }: SpinnerProps): React.ReactElement {
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setFrame((prev) => (prev + 1) % FRAMES.length);
        }, 80);
        return () => clearInterval(timer);
    }, []);

    return (
        <Text>
            <Text color={color}>{FRAMES[frame]}</Text>
            {label ? <Text> {label}</Text> : null}
        </Text>
    );
}
