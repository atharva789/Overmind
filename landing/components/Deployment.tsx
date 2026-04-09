"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import ScrollReveal from "./ScrollReveal";

const INFRA_ITEMS = [
  { label: "ECR", sublabel: "Container Registry" },
  { label: "ECS Fargate", sublabel: "Orchestrator" },
  { label: "ALB", sublabel: "Load Balancer" },
  { label: "SSM", sublabel: "Parameter Store" },
  { label: "CloudWatch", sublabel: "Logs & Metrics" },
  { label: "PostgreSQL", sublabel: "pgvector" },
];

function InfraDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div ref={ref} className="max-w-3xl mx-auto">
      <div className="grid grid-cols-3 gap-4 sm:gap-6">
        {INFRA_ITEMS.map((node, i) => (
          <motion.div
            key={node.label}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={
              isInView
                ? { opacity: 1, scale: 1 }
                : { opacity: 0, scale: 0.8 }
            }
            transition={{ duration: 0.5, delay: i * 0.1 }}
          >
            <div className="px-3 py-3 sm:px-5 sm:py-4 rounded-xl bg-overmind-panel border border-gray-700/50 text-center shadow-lg hover:border-overmind-cyan/30 transition-colors">
              <p className="text-overmind-cyan font-semibold text-xs sm:text-sm">
                {node.label}
              </p>
              <p className="text-gray-500 text-[10px] sm:text-xs mt-0.5">
                {node.sublabel}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.6, delay: 0.6 }}
        className="flex justify-center mt-4"
      >
        <div className="text-gray-600 text-xs font-mono flex items-center gap-2">
          <div className="w-12 h-px bg-gradient-to-r from-transparent to-overmind-cyan/30" />
          <span>interconnected via VPC</span>
          <div className="w-12 h-px bg-gradient-to-l from-transparent to-overmind-cyan/30" />
        </div>
      </motion.div>
    </div>
  );
}

export default function Deployment() {
  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">Deploy in 3 Commands</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-16">
            Self-host on your own infrastructure. Terraform provisions
            everything: ECS Fargate, ALB, ECR, CloudWatch, SSM parameters.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <InfraDiagram />
        </ScrollReveal>

        <ScrollReveal delay={0.3}>
          <div className="mt-16 max-w-2xl mx-auto">
            <div className="terminal-window">
              <div className="terminal-header">
                <div className="terminal-dot bg-red-500" />
                <div className="terminal-dot bg-yellow-500" />
                <div className="terminal-dot bg-green-500" />
                <span className="text-gray-500 text-sm font-mono ml-2">
                  deploy
                </span>
              </div>
              <div className="p-4 sm:p-6 font-mono text-sm space-y-3">
                <div>
                  <span className="text-gray-500">{"# Clone the repository"}</span>
                </div>
                <div>
                  <span className="text-green-400">{"$"}</span>{" "}
                  <span className="text-white">
                    {"git clone https://github.com/atharva789/Overmind.git"}
                  </span>
                </div>
                <div className="h-2" />
                <div>
                  <span className="text-gray-500">{"# Deploy infrastructure"}</span>
                </div>
                <div>
                  <span className="text-green-400">{"$"}</span>{" "}
                  <span className="text-white">
                    {"cd Overmind/infra && terraform apply"}
                  </span>
                </div>
                <div className="text-overmind-cyan">
                  {"Apply complete! Resources: 12 added, 0 changed, 0 destroyed."}
                </div>
                <div className="h-2" />
                <div>
                  <span className="text-gray-500">{"# Start a session"}</span>
                </div>
                <div>
                  <span className="text-green-400">{"$"}</span>{" "}
                  <span className="text-white">{"overmind host --port 4444"}</span>
                </div>
                <div className="text-overmind-cyan">
                  {"Server listening on :4444"}
                </div>
                <div className="text-overmind-cyan">
                  {"Party code: ABCD"}
                </div>
                <div className="mt-2 text-green-400">
                  {"$"}
                  <span className="animate-blink text-overmind-cyan ml-1">
                    {"|"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
