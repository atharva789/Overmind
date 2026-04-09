"use client";

import { useState, useCallback } from "react";
import ScrollReveal from "./ScrollReveal";

export default function Footer() {
  const [copied, setCopied] = useState(false);
  const installCommand = "npm install -g github:atharva789/Overmind";

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }, [installCommand]);

  return (
    <footer className="relative py-24 sm:py-32 px-4 sm:px-6 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-overmind-cyan/5 rounded-full blur-[120px]" />
      <div className="absolute top-1/4 left-1/3 w-[400px] h-[300px] bg-overmind-purple/5 rounded-full blur-[100px]" />

      <div className="max-w-4xl mx-auto relative text-center">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-6">
            <span className="gradient-text">Start shipping as a team</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto mb-12">
            Open source. Self-hostable. Built for teams who refuse to let AI
            coding remain a single-player experience.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.15}>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-10">
            <a
              href="https://github.com/atharva789/Overmind"
              target="_blank"
              rel="noopener noreferrer"
              className="glow-button inline-flex items-center justify-center gap-3 px-8 py-4 rounded-xl bg-overmind-cyan text-overmind-bg font-semibold text-lg hover:bg-overmind-cyan/90 transition-all"
            >
              <svg
                className="w-6 h-6"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              Star on GitHub
            </a>
            <a
              href="https://github.com/atharva789/Overmind/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl border border-gray-700 text-gray-300 font-semibold text-lg hover:border-overmind-purple/50 hover:text-overmind-purple transition-all"
            >
              Send Feedback
            </a>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.3}>
          <div className="max-w-xl mx-auto">
            <p className="text-gray-500 text-sm mb-3 font-mono">
              Install globally
            </p>
            <div className="flex items-center gap-2 bg-overmind-panel/80 border border-gray-800/50 rounded-xl p-3 sm:p-4">
              <code className="flex-1 text-left text-overmind-cyan text-sm font-mono truncate">
                {installCommand}
              </code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-700/50 transition-colors text-gray-400 hover:text-white"
                aria-label="Copy to clipboard"
              >
                {copied ? (
                  <svg
                    className="w-5 h-5 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </ScrollReveal>

        {/* Bottom bar */}
        <div className="mt-20 pt-8 border-t border-gray-800/50">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-overmind-cyan to-overmind-purple flex items-center justify-center">
                <span className="text-white text-xs font-bold">O</span>
              </div>
              <span className="text-gray-500 text-sm font-mono">
                Overmind
              </span>
            </div>
            <p className="text-gray-600 text-sm">
              Built at Princeton. Open source under MIT.
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/atharva789/Overmind"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-overmind-cyan transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
