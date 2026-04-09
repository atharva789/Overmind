"use client";

import ScrollReveal from "./ScrollReveal";

interface FeatureRow {
  readonly feature: string;
  readonly copilot: boolean | string;
  readonly cursor: boolean | string;
  readonly devin: boolean | string;
  readonly overmind: boolean | string;
}

const FEATURES: readonly FeatureRow[] = [
  {
    feature: "Multiplayer sessions",
    copilot: false,
    cursor: false,
    devin: false,
    overmind: true,
  },
  {
    feature: "Shared context across devs",
    copilot: false,
    cursor: false,
    devin: false,
    overmind: true,
  },
  {
    feature: "AI merge resolution",
    copilot: false,
    cursor: false,
    devin: false,
    overmind: true,
  },
  {
    feature: "Host approval gate",
    copilot: false,
    cursor: false,
    devin: "Async",
    overmind: true,
  },
  {
    feature: "Scope-bounded execution",
    copilot: false,
    cursor: "Partial",
    devin: true,
    overmind: true,
  },
  {
    feature: "Multi-agent pipeline",
    copilot: false,
    cursor: false,
    devin: true,
    overmind: true,
  },
  {
    feature: "Greenlight safety check",
    copilot: false,
    cursor: false,
    devin: false,
    overmind: true,
  },
  {
    feature: "Real-time streaming UI",
    copilot: true,
    cursor: true,
    devin: false,
    overmind: true,
  },
  {
    feature: "Self-hostable",
    copilot: false,
    cursor: false,
    devin: false,
    overmind: true,
  },
  {
    feature: "Open source",
    copilot: false,
    cursor: false,
    devin: false,
    overmind: true,
  },
];

function CellValue({ value }: { readonly value: boolean | string }) {
  if (value === true) {
    return (
      <span className="text-green-400 text-lg">\u2713</span>
    );
  }
  if (value === false) {
    return (
      <span className="text-gray-600 text-lg">\u2717</span>
    );
  }
  return <span className="text-yellow-400 text-xs font-mono">{value}</span>;
}

export default function ComparisonTable() {
  return (
    <section className="relative py-24 sm:py-32 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <ScrollReveal>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-4">
            <span className="gradient-text">How We Compare</span>
          </h2>
          <p className="text-gray-400 text-lg text-center max-w-2xl mx-auto mb-12">
            Overmind is not a replacement for single-player tools. It is the
            multiplayer layer that none of them have.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.15}>
          <div className="overflow-x-auto rounded-2xl border border-gray-800/50">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800/50">
                  <th className="text-left text-gray-400 font-medium text-sm py-4 px-4 sm:px-6">
                    Feature
                  </th>
                  <th className="text-center text-gray-400 font-medium text-sm py-4 px-3 sm:px-6">
                    Copilot
                  </th>
                  <th className="text-center text-gray-400 font-medium text-sm py-4 px-3 sm:px-6">
                    Cursor
                  </th>
                  <th className="text-center text-gray-400 font-medium text-sm py-4 px-3 sm:px-6">
                    Devin
                  </th>
                  <th className="text-center py-4 px-3 sm:px-6">
                    <span className="text-overmind-cyan font-bold text-sm">
                      Overmind
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b border-gray-800/30 last:border-b-0 hover:bg-overmind-panel/30 transition-colors"
                  >
                    <td className="text-gray-300 text-sm py-3.5 px-4 sm:px-6 font-medium">
                      {row.feature}
                    </td>
                    <td className="text-center py-3.5 px-3 sm:px-6">
                      <CellValue value={row.copilot} />
                    </td>
                    <td className="text-center py-3.5 px-3 sm:px-6">
                      <CellValue value={row.cursor} />
                    </td>
                    <td className="text-center py-3.5 px-3 sm:px-6">
                      <CellValue value={row.devin} />
                    </td>
                    <td className="text-center py-3.5 px-3 sm:px-6 bg-overmind-cyan/[0.03]">
                      <CellValue value={row.overmind} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
