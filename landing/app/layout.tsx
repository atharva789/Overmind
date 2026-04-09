import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Overmind - The Multiplayer AI Coding Terminal",
  description:
    "One session. Multiple developers. One AI pipeline. Zero merge conflicts. Overmind is the multiplayer AI coding terminal that coordinates multi-agent execution across your team.",
  keywords: [
    "AI coding",
    "multiplayer development",
    "AI terminal",
    "code generation",
    "merge resolution",
    "developer tools",
  ],
  openGraph: {
    title: "Overmind - The Multiplayer AI Coding Terminal",
    description:
      "One session. Multiple developers. One AI pipeline. Zero merge conflicts.",
    type: "website",
    url: "https://github.com/atharva789/Overmind",
  },
  twitter: {
    card: "summary_large_image",
    title: "Overmind - The Multiplayer AI Coding Terminal",
    description:
      "One session. Multiple developers. One AI pipeline. Zero merge conflicts.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
