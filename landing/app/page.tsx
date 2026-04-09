import Hero from "@/components/Hero";
import ProblemStatement from "@/components/ProblemStatement";
import Pipeline from "@/components/Pipeline";
import TerminalDemo from "@/components/TerminalDemo";
import Architecture from "@/components/Architecture";
import ComparisonTable from "@/components/ComparisonTable";
import TechnicalDepth from "@/components/TechnicalDepth";
import Deployment from "@/components/Deployment";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="relative min-h-screen bg-overmind-bg text-gray-200 overflow-x-hidden">
      {/* Subtle top-level gradient overlay */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-overmind-cyan/20 to-transparent" />
      </div>

      <div className="relative z-10">
        <Hero />

        {/* Divider */}
        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <ProblemStatement />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <Pipeline />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <TerminalDemo />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <Architecture />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <ComparisonTable />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <TechnicalDepth />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <Deployment />

        <div className="max-w-6xl mx-auto px-6">
          <div className="h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />
        </div>

        <Footer />
      </div>
    </main>
  );
}
