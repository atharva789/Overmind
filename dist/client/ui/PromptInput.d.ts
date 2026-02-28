import React from "react";
interface PromptInputProps {
    disabled: boolean;
    onSubmit: (promptId: string, content: string) => void;
    onTyping: () => void;
    onIdle: () => void;
}
export default function PromptInput({ disabled, onSubmit, onTyping, onIdle, }: PromptInputProps): React.ReactElement;
export {};
