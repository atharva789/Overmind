"use client";

import ScrollReveal from "./ScrollReveal";

const FEATURES = [
  {
    title: "20+ Zod Message Types",
    description:
      "Every WebSocket message is a Zod-validated discriminated union. Invalid messages are logged and dropped, never propagated. Type safety from wire to render.",
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    color: "from-cyan-500/10 to-cyan-500/0",
    borderColor: "border-cyan-500/20",
    iconColor: "text-overmind-cyan",
  },
  {
    title: "Scope-Bounded Execution",
    description:
      "Gemini analyzes each prompt to identify the minimum set of affected files (capped at 15). Agents never touch what they should not. Blast radius is controlled.",
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
      </svg>
    ),
    color: "from-purple-500/10 to-purple-500/0",
    borderColor: "border-purple-500/20",
    iconColor: "text-overmind-purple",
  },
  {
    title: "AI Merge Resolution",
    description:
      "When concurrent prompts create conflicting changes, Overmind detects the conflict, generates a resolution, and reports a confidence score. High confidence merges automatically.",
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
    color: "from-green-500/10 to-green-500/0",
    borderColor: "border-green-500/20",
    iconColor: "text-green-400",
  },
  {
    title: "Langfuse Observability",
    description:
      "Every agent invocation is traced with Langfuse. See spans, token counts, latency, and cost per prompt. Debug the AI pipeline like you would debug code.",
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    color: "from-yellow-500/10 to-yellow-500/0",
    borderColor: "border-yellow-500/20",
    iconColor: "text-yellow-400",
  },
  {
    title: "pgvector Clustering",
    description:
      "Prompts are embedded and clustered into semantic features using PostgreSQL with pgvector. Related changes are grouped into coherent stories automatically.",
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    color: "from-blue-500/10 to-blue-500/0",
    borderColor: "border-blue-500/20",
    iconColor: "text-blue-400",
  },
  {
    title: "Privacy Invariant",
    description:
      "Prompt content is visible only to the submitter and the host. It is never broadcast to other members. This is enforced server-side and is a critical security invariant.",
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    color: "from-red-500/10 to-red-500/0",
    borderColor: "border-red-500/20",
    iconColor: "text-red-400",
  },
];

export default function TechnicalDepth() {
  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6">
      <div className="absolute inset-0 dot-pattern opacity-20" />

      <div className="max-w-6xl mx-auto relative">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">Built for Production</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-16">
            Not a prototype. Not a demo. Overmind is built with the same
            discipline as the production systems it helps you write.
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, index) => (
            <ScrollReveal key={feature.title} delay={index * 0.1}>
              <div className={`group relative p-6 rounded-2xl bg-overmind-panel/40 border ${feature.borderColor} hover:border-opacity-60 transition-all duration-300 h-full`}>
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-b ${feature.color} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="relative">
                  <div className={`${feature.iconColor} mb-4`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-400 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
