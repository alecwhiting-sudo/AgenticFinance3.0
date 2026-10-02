import type { Metadata } from "next";
import Link from "next/link";
import CommandPalette from "@/components/CommandPalette";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AgenticFinance", template: "%s · AgenticFinance" },
  description: "Agentic finance workbench",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/agents", label: "Agents" },
  { href: "/p2p", label: "P2P" },
  { href: "/ledger", label: "Ledger" },
  { href: "/r2r", label: "R2R" },
  { href: "/reports", label: "Reports" },
  { href: "/work", label: "Work" },
  { href: "/approvals", label: "Approvals" },
  { href: "/admin", label: "Admin" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="mx-auto max-w-5xl px-4 py-8">
          <header className="mb-8 flex items-baseline justify-between">
            <div className="flex items-baseline gap-8">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                AgenticFinance
              </Link>
              <nav className="flex gap-5 text-sm">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="hover:underline"
                    style={{ color: "var(--muted)" }}
                  >
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
            <span className="flex items-center gap-3">
              <CommandPalette />
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                workbench · demo
              </span>
            </span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
