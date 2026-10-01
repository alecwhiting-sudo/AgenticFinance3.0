import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgenticFinance",
  description: "Agentic finance workbench",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="mx-auto max-w-5xl px-4 py-10">
          <header className="mb-10 flex items-baseline justify-between">
            <h1 className="text-lg font-semibold tracking-tight">
              AgenticFinance
            </h1>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              workbench · demo
            </span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
