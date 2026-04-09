"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import ScrollReveal from "./ScrollReveal";

const STAGES = [
  {
    name: "Submit",
    description: "Developer submits a prompt via the CLI",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    ),
  },
  {
    name: "Queue",
    description: "FIFO party queue ensures deterministic order",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
  },
  {
    name: "Scope",
    description: "Gemini identifies affected files (max 15)",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    name: "Greenlight",
    description: "AI safety check evaluates the request",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  {
    name: "Approve",
    description: "Host reviews and approves execution",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  {
    name: "Execute",
    description: "Multi-agent pipeline: plan, code, evaluate",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    name: "Merge",
    description: "AI resolves conflicts with confidence scoring",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    name: "PR",
    description: "Changes committed, pull request opened",
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
];

function PipelineStage({
  stage,
  index,
  isInView,
}: {
  readonly stage: (typeof STAGES)[number];
  readonly index: number;
  readonly isInView: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={
        isInView
          ? { opacity: 1, scale: 1 }
          : { opacity: 0, scale: 0.8 }
      }
      transition={{
        duration: 0.5,
        delay: index * 0.12,
        ease: [0.25, 0.4, 0.25, 1],
      }}
      className="flex flex-col items-center"
    >
      <motion.div
        initial={{ borderColor: "rgba(75, 85, 99, 0.5)" }}
        animate={
          isInView
            ? {
                borderColor: "rgba(0, 212, 255, 0.5)",
                boxShadow: "0 0 20px rgba(0, 212, 255, 0.15)",
              }
            : { borderColor: "rgba(75, 85, 99, 0.5)" }
        }
        transition={{ duration: 0.4, delay: index * 0.12 + 0.3 }}
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-overmind-panel border flex items-center justify-center text-overmind-cyan mb-3"
      >
        {stage.icon}
      </motion.div>
      <p className="text-white font-semibold text-sm sm:text-base mb-1">
        {stage.name}
      </p>
      <p className="text-gray-500 text-xs sm:text-sm text-center max-w-[120px] leading-tight">
        {stage.description}
      </p>
    </motion.div>
  );
}

export default function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6 overflow-hidden">
      <div className="absolute inset-0 dot-pattern opacity-20" />

      <div className="max-w-6xl mx-auto relative">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">How It Works</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-16">
            Every prompt flows through a deterministic pipeline. No ambiguity, no
            race conditions, no surprise merges.
          </p>
        </ScrollReveal>

        {/* Desktop pipeline: horizontal */}
        <div ref={ref} className="hidden lg:block">
          <div className="relative">
            {/* Connector line */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={isInView ? { scaleX: 1 } : { scaleX: 0 }}
              transition={{ duration: 1.2, delay: 0.3, ease: "easeOut" }}
              className="absolute top-8 left-[8%] right-[8%] h-[2px] origin-left"
              style={{
                background:
                  "linear-gradient(90deg, #00d4ff, #8b5cf6, #00d4ff)",
              }}
            />

            <div className="grid grid-cols-8 gap-2">
              {STAGES.map((stage, index) => (
                <PipelineStage
                  key={stage.name}
                  stage={stage}
                  index={index}
                  isInView={isInView}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Mobile/Tablet pipeline: 2x4 grid */}
        <div ref={!ref.current ? ref : undefined} className="lg:hidden">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            {STAGES.map((stage, index) => (
              <PipelineStage
                key={stage.name}
                stage={stage}
                index={index}
                isInView={isInView}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
