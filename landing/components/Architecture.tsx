"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import ScrollReveal from "./ScrollReveal";

interface NodeProps {
  readonly label: string;
  readonly sublabel?: string;
  readonly color: "cyan" | "purple" | "green" | "yellow" | "white";
  readonly delay: number;
  readonly isInView: boolean;
  readonly className?: string;
}

const NODE_COLORS = {
  cyan: {
    border: "border-overmind-cyan/40",
    bg: "bg-overmind-cyan/5",
    text: "text-overmind-cyan",
    glow: "shadow-overmind-cyan/10",
  },
  purple: {
    border: "border-overmind-purple/40",
    bg: "bg-overmind-purple/5",
    text: "text-overmind-purple",
    glow: "shadow-overmind-purple/10",
  },
  green: {
    border: "border-green-500/40",
    bg: "bg-green-500/5",
    text: "text-green-400",
    glow: "shadow-green-500/10",
  },
  yellow: {
    border: "border-yellow-500/40",
    bg: "bg-yellow-500/5",
    text: "text-yellow-400",
    glow: "shadow-yellow-500/10",
  },
  white: {
    border: "border-gray-600/40",
    bg: "bg-gray-800/30",
    text: "text-gray-300",
    glow: "shadow-gray-500/10",
  },
};

function ArchNode({ label, sublabel, color, delay, isInView, className = "" }: NodeProps) {
  const c = NODE_COLORS[color];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.4, 0.25, 1] }}
      className={`px-4 py-3 rounded-xl border ${c.border} ${c.bg} shadow-lg ${c.glow} ${className}`}
    >
      <p className={`font-semibold text-sm ${c.text}`}>{label}</p>
      {sublabel && (
        <p className="text-gray-500 text-xs mt-0.5">{sublabel}</p>
      )}
    </motion.div>
  );
}

function Arrow({
  isInView,
  delay,
  direction = "down",
}: {
  readonly isInView: boolean;
  readonly delay: number;
  readonly direction?: "down" | "right";
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : { opacity: 0 }}
      transition={{ duration: 0.3, delay }}
      className={`flex ${direction === "down" ? "justify-center py-1" : "items-center px-1"}`}
    >
      {direction === "down" ? (
        <svg className="w-4 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 16 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 2v18m0 0l-4-4m4 4l4-4" />
        </svg>
      ) : (
        <svg className="w-6 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 16">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 8h18m0 0l-4-4m4 4l-4 4" />
        </svg>
      )}
    </motion.div>
  );
}

export default function Architecture() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 overflow-hidden">
      <div className="absolute inset-0 dot-pattern opacity-20" />

      <div className="max-w-5xl mx-auto relative">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">Architecture</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-16">
            Layered design with clear separation. Local or remote execution.
            Every message type-safe via Zod.
          </p>
        </ScrollReveal>

        <div ref={ref} className="flex flex-col items-center gap-1">
          {/* Clients row */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-mono"
          >
            Clients
          </motion.div>
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            <ArchNode label="alice" sublabel="Ink TUI" color="cyan" delay={0} isInView={isInView} />
            <ArchNode label="bob" sublabel="Ink TUI" color="cyan" delay={0.1} isInView={isInView} />
            <ArchNode label="carol" sublabel="Ink TUI" color="cyan" delay={0.2} isInView={isInView} />
          </div>

          <Arrow isInView={isInView} delay={0.3} />

          {/* WebSocket Server */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
            className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-mono"
          >
            WebSocket Server
          </motion.div>
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            <ArchNode label="Party Manager" sublabel="Members, Queue, Broadcast" color="purple" delay={0.3} isInView={isInView} />
            <ArchNode label="Scope Extraction" sublabel="Gemini file analysis" color="purple" delay={0.4} isInView={isInView} />
            <ArchNode label="Greenlight" sublabel="AI safety check" color="purple" delay={0.5} isInView={isInView} />
          </div>

          <Arrow isInView={isInView} delay={0.6} />

          {/* Host approval */}
          <ArchNode label="Host Approval Gate" sublabel="Human-in-the-loop" color="yellow" delay={0.6} isInView={isInView} />

          <Arrow isInView={isInView} delay={0.7} />

          {/* Execution - two paths */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.65 }}
            className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-mono"
          >
            Execution (choose one)
          </motion.div>
          <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 items-center">
            <div className="flex flex-col items-center gap-2">
              <ArchNode
                label="Local Agent"
                sublabel="Gemini tool-calling loop"
                color="green"
                delay={0.7}
                isInView={isInView}
                className="min-w-[200px] text-center"
              />
              <div className="flex gap-2 flex-wrap justify-center">
                <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono">read_file</span>
                <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono">write_file</span>
                <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono">list_dir</span>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={isInView ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.75 }}
              className="text-gray-600 font-mono text-sm"
            >
              OR
            </motion.div>

            <div className="flex flex-col items-center gap-2">
              <ArchNode
                label="Remote Orchestrator"
                sublabel="ECS Fargate + FastAPI"
                color="green"
                delay={0.8}
                isInView={isInView}
                className="min-w-[200px] text-center"
              />
              <div className="flex gap-2 flex-wrap justify-center">
                <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono">Sandbox</span>
                <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono">File Sync</span>
                <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-mono">Polling</span>
              </div>
            </div>
          </div>

          <Arrow isInView={isInView} delay={0.9} />

          {/* Merge + PR */}
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            <ArchNode label="AI Merge Resolution" sublabel="Conflict detection + resolution" color="yellow" delay={0.9} isInView={isInView} />
            <ArchNode label="PR Creation" sublabel="Commit + open pull request" color="green" delay={1.0} isInView={isInView} />
          </div>

          <Arrow isInView={isInView} delay={1.1} />

          {/* Observability */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.3, delay: 1.0 }}
            className="text-gray-500 text-xs uppercase tracking-wider mb-2 font-mono"
          >
            Observability
          </motion.div>
          <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
            <ArchNode label="Langfuse" sublabel="Traces, spans, tokens" color="white" delay={1.1} isInView={isInView} />
            <ArchNode label="PostgreSQL" sublabel="pgvector clustering" color="white" delay={1.2} isInView={isInView} />
            <ArchNode label="CloudWatch" sublabel="Logs & metrics" color="white" delay={1.3} isInView={isInView} />
          </div>
        </div>
      </div>
    </section>
  );
}
