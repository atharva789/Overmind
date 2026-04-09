"use client";

import ScrollReveal from "./ScrollReveal";

const PROBLEMS = [
  {
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "No Shared Context",
    description:
      "Every developer runs their own isolated AI agent. They duplicate work, miss dependencies, and operate without awareness of what teammates are doing.",
  },
  {
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: "No Coordination",
    description:
      "Multiple agents edit the same files simultaneously. There is no queue, no scope boundaries, and no approval gate. Conflicting changes pile up silently.",
  },
  {
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
    title: "No Merge Resolution",
    description:
      "When conflicts inevitably arise, developers are left to manually resolve them. Hours wasted untangling AI-generated code that was never designed to coexist.",
  },
];

export default function ProblemStatement() {
  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">AI coding tools are single-player</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-16">
            The current generation of AI coding assistants was designed for one
            developer, one agent, one context window. Teams deserve better.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {PROBLEMS.map((problem, index) => (
            <ScrollReveal key={problem.title} delay={index * 0.15}>
              <div className="group relative p-6 sm:p-8 rounded-2xl bg-overmind-panel/60 border border-gray-800/50 hover:border-red-500/30 transition-all duration-300 h-full">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-b from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative">
                  <div className="text-red-400 mb-4">{problem.icon}</div>
                  <h3 className="text-xl font-semibold text-white mb-3">
                    {problem.title}
                  </h3>
                  <p className="text-gray-400 leading-relaxed">
                    {problem.description}
                  </p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.3}>
          <div className="relative p-8 rounded-2xl bg-gradient-to-r from-overmind-cyan/5 via-overmind-purple/5 to-overmind-cyan/5 border border-overmind-cyan/10 text-center">
            <p className="text-2xl sm:text-3xl font-bold text-white mb-2">
              $45B developer tools market
            </p>
            <p className="text-overmind-cyan text-lg">
              has a multiplayer-shaped hole.
            </p>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
