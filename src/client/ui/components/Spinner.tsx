/**
 * Purpose: Animated spinner component for in-progress state feedback.
 *
 * High-level behavior: Cycles through Braille dot frames at ~80 ms per
 * frame using a setInterval. Renders as a single cyan character.
 *
 * Assumptions:
 *  - Component is mounted only when a spinner should be visible.
 *
 * Invariants:
 *  - Interval is always cleared on unmount to prevent memory leaks.
 */

import { useState, useEffect } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{FRAMES[frame]}</Text>;
}
