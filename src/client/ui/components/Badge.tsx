import React from "react";
import { Text } from "ink";

interface BadgeProps {
    label: string;
    color: string;
}

export default function Badge({ label, color }: BadgeProps): React.ReactElement {
    return (
        <Text color={color} bold>
            {` ${label.toUpperCase()} `}
        </Text>
    );
}
