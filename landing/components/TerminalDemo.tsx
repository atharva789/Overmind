"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useInView } from "framer-motion";
import ScrollReveal from "./ScrollReveal";

const DEMO_LINES = [
  { text: "$ overmind host --port 4444", style: "text-green-400" },
  { text: "\u{1F50C} Server listening on :4444", style: "text-overmind-cyan" },
  { text: "\u{1F4CB} Party code: XKRF", style: "text-overmind-cyan" },
  { text: "", style: "" },
  { text: "[XKRF] alice joined (2/8)", style: "text-yellow-400" },
  { text: "", style: "" },
  {
    text: "alice> Add rate limiting to all /api routes",
    style: "text-white font-semibold",
  },
  { text: "", style: "" },
  {
    text: "  Scope: 4 files \u00B7 moderate complexity",
    style: "text-gray-400",
  },
  { text: "  Greenlight: \u2705 safe", style: "text-green-400" },
  { text: "  Host: approved \u2713", style: "text-green-400" },
  { text: "", style: "" },
  {
    text: "  Task 1/3  Create middleware        \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 done",
    style: "text-overmind-cyan",
  },
  {
    text: "  Task 2/3  Wire into routes         \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 done",
    style: "text-overmind-cyan",
  },
  {
    text: "  Task 3/3  Add tests                \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 done",
    style: "text-overmind-cyan",
  },
  { text: "", style: "" },
  {
    text: "  \u2705 4 files changed \u00B7 PR #42 opened",
    style: "text-green-400 font-semibold",
  },
  { text: "", style: "" },
  { text: "[XKRF] bob joined (3/8)", style: "text-yellow-400" },
  { text: "", style: "" },
  {
    text: 'bob> Add OpenAPI docs to all endpoints',
    style: "text-white font-semibold",
  },
  { text: "", style: "" },
  {
    text: "  Scope: 7 files \u00B7 moderate complexity",
    style: "text-gray-400",
  },
  { text: "  Greenlight: \u2705 safe", style: "text-green-400" },
  { text: "  Host: approved \u2713", style: "text-green-400" },
  { text: "", style: "" },
  {
    text: "  Task 1/2  Generate OpenAPI specs    \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 done",
    style: "text-overmind-cyan",
  },
  {
    text: "  Task 2/2  Add route decorators      \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588 done",
    style: "text-overmind-cyan",
  },
  { text: "", style: "" },
  {
    text: "  \u26A0\uFE0F  Merge conflict in routes/api.ts",
    style: "text-yellow-400",
  },
  {
    text: "  \u{1F9E0} AI resolution: confidence 0.94",
    style: "text-overmind-purple",
  },
  {
    text: "  \u2705 7 files changed \u00B7 PR #43 opened \u00B7 conflict resolved",
    style: "text-green-400 font-semibold",
  },
];

export default function TerminalDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-100px" });
  const [visibleLines, setVisibleLines] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  const typeLine = useCallback(
    (lineIndex: number) => {
      if (lineIndex >= DEMO_LINES.length) return;

      const line = DEMO_LINES[lineIndex];

      if (line.text === "") {
        setVisibleLines(lineIndex + 1);
        setTimeout(() => typeLine(lineIndex + 1), 150);
        return;
      }

      let charIndex = 0;
      setCurrentText("");

      const typeChar = () => {
        if (charIndex < line.text.length) {
          setCurrentText(line.text.slice(0, charIndex + 1));
          charIndex++;
          const speed = line.text.startsWith("  Task") ? 8 : 18 + Math.random() * 20;
          setTimeout(typeChar, speed);
        } else {
          setVisibleLines(lineIndex + 1);
          setCurrentText("");

          if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
          }

          const pause = line.text.startsWith("  \u2705") ? 800 : line.text.startsWith("alice>") || line.text.startsWith("bob>") ? 600 : 200;
          setTimeout(() => typeLine(lineIndex + 1), pause);
        }
      };

      setTimeout(typeChar, 100);
    },
    []
  );

  useEffect(() => {
    if (isInView && !hasStarted) {
      setHasStarted(true);
      setTimeout(() => typeLine(0), 500);
    }
  }, [isInView, hasStarted, typeLine]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [visibleLines, currentText]);

  return (
    <section
      id="terminal-demo"
      className="relative py-24 sm:py-32 px-4 sm:px-6"
      ref={containerRef}
    >
      <div className="max-w-4xl mx-auto">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">See It In Action</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-12">
            Two developers, two prompts, one session. Watch Overmind coordinate
            execution and resolve a merge conflict automatically.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.2}>
          <div className="terminal-window shadow-2xl shadow-overmind-cyan/10">
            <div className="terminal-header">
              <div className="terminal-dot bg-red-500" />
              <div className="terminal-dot bg-yellow-500" />
              <div className="terminal-dot bg-green-500" />
              <span className="text-gray-500 text-sm font-mono ml-2">
                overmind ~ party XKRF
              </span>
            </div>
            <div
              ref={terminalRef}
              className="p-4 sm:p-6 font-mono text-sm leading-relaxed max-h-[480px] overflow-y-auto"
            >
              {DEMO_LINES.slice(0, visibleLines).map((line, i) => (
                <div
                  key={i}
                  className={`${line.style} ${line.text === "" ? "h-3" : ""}`}
                >
                  {line.text}
                </div>
              ))}
              {visibleLines < DEMO_LINES.length && currentText && (
                <div
                  className={
                    DEMO_LINES[visibleLines]?.style ?? "text-white"
                  }
                >
                  {currentText}
                  <span className="animate-blink text-overmind-cyan">|</span>
                </div>
              )}
              {visibleLines >= DEMO_LINES.length && (
                <div className="mt-1 text-green-400">
                  $
                  <span className="animate-blink text-overmind-cyan ml-1">
                    |
                  </span>
                </div>
              )}
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
