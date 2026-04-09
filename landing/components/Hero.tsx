"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";

const TERMINAL_LINES = [
  { text: "$ overmind host --port 4444", color: "text-green-400", delay: 0 },
  {
    text: "\u{1F50C} Server listening on :4444",
    color: "text-overmind-cyan",
    delay: 800,
  },
  {
    text: "\u{1F4CB} Party code: XKRF",
    color: "text-overmind-cyan",
    delay: 1200,
  },
  { text: "", color: "", delay: 1600 },
  {
    text: "[XKRF] alice joined (2/8)",
    color: "text-yellow-400",
    delay: 2000,
  },
  {
    text: "[XKRF] bob joined (3/8)",
    color: "text-yellow-400",
    delay: 2600,
  },
  { text: "", color: "", delay: 3000 },
  {
    text: 'alice> "Add authentication to the API"',
    color: "text-white",
    delay: 3400,
  },
  {
    text: "  \u2192 Queued \u2022 Scope: 6 files \u2022 Greenlight: \u2705",
    color: "text-gray-400",
    delay: 4200,
  },
  { text: "  \u2192 Host approved \u2713", color: "text-green-400", delay: 4800 },
  { text: "  \u2192 Executing...", color: "text-overmind-purple", delay: 5400 },
  {
    text: "  \u2705 6 files changed \u00B7 PR #12 opened",
    color: "text-green-400",
    delay: 6200,
  },
];

function TerminalMockup() {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [currentText, setCurrentText] = useState<string>("");
  const [isTyping, setIsTyping] = useState<boolean>(true);

  const typeLine = useCallback((lineIndex: number) => {
    if (lineIndex >= TERMINAL_LINES.length) {
      setIsTyping(false);
      return;
    }

    const line = TERMINAL_LINES[lineIndex];

    if (line.text === "") {
      setVisibleLines(lineIndex + 1);
      setTimeout(() => typeLine(lineIndex + 1), 300);
      return;
    }

    let charIndex = 0;
    setCurrentText("");

    const typeChar = () => {
      if (charIndex < line.text.length) {
        setCurrentText(line.text.slice(0, charIndex + 1));
        charIndex++;
        setTimeout(typeChar, 15 + Math.random() * 25);
      } else {
        setVisibleLines(lineIndex + 1);
        setCurrentText("");
        const nextDelay =
          lineIndex + 1 < TERMINAL_LINES.length
            ? TERMINAL_LINES[lineIndex + 1].delay - line.delay
            : 500;
        setTimeout(() => typeLine(lineIndex + 1), Math.max(nextDelay, 200));
      }
    };

    setTimeout(typeChar, 100);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => typeLine(0), 1000);
    return () => clearTimeout(timer);
  }, [typeLine]);

  return (
    <div className="terminal-window w-full max-w-2xl mx-auto shadow-2xl shadow-overmind-cyan/10">
      <div className="terminal-header">
        <div className="terminal-dot bg-red-500" />
        <div className="terminal-dot bg-yellow-500" />
        <div className="terminal-dot bg-green-500" />
        <span className="text-gray-500 text-sm font-mono ml-2">
          overmind session
        </span>
      </div>
      <div className="p-4 sm:p-6 font-mono text-sm leading-relaxed min-h-[320px]">
        {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
          <div key={i} className={`${line.color} ${line.text === "" ? "h-4" : ""}`}>
            {line.text}
          </div>
        ))}
        {visibleLines < TERMINAL_LINES.length && currentText && (
          <div className={TERMINAL_LINES[visibleLines]?.color ?? "text-white"}>
            {currentText}
            <span className="animate-blink text-overmind-cyan">|</span>
          </div>
        )}
        {!isTyping && (
          <div className="mt-1 text-green-400">
            $<span className="animate-blink text-overmind-cyan ml-1">|</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 dot-pattern opacity-40" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-overmind-cyan/5 rounded-full blur-[120px]" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-overmind-purple/5 rounded-full blur-[100px]" />

      <div className="relative z-10 max-w-5xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-overmind-cyan/20 bg-overmind-cyan/5 text-overmind-cyan text-sm font-mono mb-8">
            <span className="w-2 h-2 bg-overmind-cyan rounded-full animate-pulse" />
            Open Source Multiplayer AI Terminal
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.15, ease: [0.25, 0.4, 0.25, 1] }}
          className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-6"
        >
          <span className="gradient-text">The Multiplayer</span>
          <br />
          <span className="gradient-text">AI Coding Terminal</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
          className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-10"
        >
          One session. Multiple developers. One AI pipeline.
          <br className="hidden sm:block" />
          Zero merge conflicts.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.45, ease: [0.25, 0.4, 0.25, 1] }}
          className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
        >
          <a
            href="https://github.com/atharva789/Overmind"
            target="_blank"
            rel="noopener noreferrer"
            className="glow-button inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-overmind-cyan text-overmind-bg font-semibold text-lg hover:bg-overmind-cyan/90 transition-all"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Get Started
          </a>
          <a
            href="#terminal-demo"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border border-gray-700 text-gray-300 font-semibold text-lg hover:border-overmind-cyan/50 hover:text-overmind-cyan transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Watch Demo
          </a>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <TerminalMockup />
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="w-6 h-10 rounded-full border-2 border-gray-600 flex items-start justify-center p-1"
        >
          <div className="w-1.5 h-2.5 rounded-full bg-gray-500" />
        </motion.div>
      </motion.div>
    </section>
  );
}
