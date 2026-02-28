import React from "react";
interface DiffBlockProps {
    filename: string;
    diff: string;
}
export default function DiffBlock({ filename, diff }: DiffBlockProps): React.ReactElement;
export {};
