import type { Metadata } from "next";
import Link from "next/link";
// Typography system (UI_CONVENTIONS §4.1): Inter for UI, IBM Plex Mono for
// data — self-hosted via fontsource (no build-time font downloads).
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
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
  { href: "/o2c", label: "O2C" },
  { href: "/ledger", label: "Ledger" },
  { href: "/r2r", label: "R2R" },
  { href: "/reports", label: "Reports" },
  { href: "/work", label: "Work" },
  { href: "/approvals", label: "Approvals" },
  { href: "/test", label: "Test" },
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
        <div className="mx-auto max-w-6xl px-4 py-8">
          <header className="mb-8 flex items-baseline justify-between">
            <div className="flex items-baseline gap-8">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                AgenticFinance
              </Link>
              <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
            <CommandPalette />
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
