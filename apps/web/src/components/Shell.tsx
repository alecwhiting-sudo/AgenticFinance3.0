"use client";

/** The app shell (UI_CONVENTIONS §1.1 v2): a fixed left sidebar carrying the
 * full navigation tree — parents as strong rows, children indented beneath —
 * plus a top bar with the area (parent) links and the command palette. Top
 * bar for areas, sidebar for the tree: the standard two-level app pattern
 * (Stripe/GitHub), not duplication. Content uses the full viewport width. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import CommandPalette from "@/components/CommandPalette";
import AnalystPanel from "@/components/AnalystPanel";

type Item = { href: string; label: string; exact?: boolean };
type Parent = Item & { short?: string; children?: Item[] };

const NAV: Parent[] = [
  { href: "/", label: "Dashboard", exact: true },
  {
    href: "/p2p",
    label: "Procure to Pay",
    short: "P2P",
    exact: true,
    children: [
      { href: "/p2p/purchases", label: "Purchases" },
      { href: "/p2p/invoices", label: "Invoices" },
      { href: "/p2p/exceptions", label: "Exceptions" },
      { href: "/p2p/payments", label: "Payments" },
      { href: "/p2p/flow", label: "Live flow" },
    ],
  },
  { href: "/o2c", label: "Order to Cash", short: "O2C" },
  {
    href: "/r2r",
    label: "Record to Report",
    short: "R2R",
    children: [
      { href: "/ledger", label: "Ledger" },
      { href: "/reports", label: "Reports" },
      { href: "/analytics", label: "Analytics" },
    ],
  },
  {
    href: "/agents",
    label: "Agents",
    children: [
      { href: "/agents/skills", label: "Skills library" },
      { href: "/work", label: "Work queue" },
      { href: "/approvals", label: "Approvals" },
      { href: "/decisions", label: "Decisions" },
    ],
  },
  { href: "/test", label: "Test panel", short: "Test" },
  {
    href: "/admin",
    label: "Admin",
    exact: true,
    children: [{ href: "/admin/architecture", label: "Architecture" }],
  },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // the Analyst chat panel (plans/ANALYTICS.md M2) — open state survives
  // navigation and reloads; the conversation itself lives in the panel
  const [analystOpen, setAnalystOpen] = useState(false);
  // the sidebar folds away (handle stays top-left) so content can breathe,
  // especially with the Analyst panel open
  const [navOpen, setNavOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("analystPanel") === "open") setAnalystOpen(true);
      if (localStorage.getItem("sidebar") === "closed") setNavOpen(false);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggleAnalyst = (open: boolean) => {
    setAnalystOpen(open);
    try {
      localStorage.setItem("analystPanel", open ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  };
  const toggleNav = (open: boolean) => {
    setNavOpen(open);
    try {
      localStorage.setItem("sidebar", open ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  };
  const isActive = (it: Item) =>
    it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
  // a parent lights up for itself or any of its children
  const parentActive = (p: Parent) => isActive(p) || (p.children ?? []).some(isActive);

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 h-screen w-56 shrink-0 flex-col overflow-y-auto border-r px-3 py-5 ${navOpen ? "hidden md:flex" : "hidden"}`}
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <div className="mb-6 flex items-center justify-between px-2">
          <Link href="/" className="text-base font-semibold tracking-tight">
            AgenticFinance
          </Link>
          <button
            onClick={() => toggleNav(false)}
            className="rounded-md px-1.5 py-0.5 text-sm transition-colors hover:text-[var(--accent)]"
            style={{ color: "var(--muted)" }}
            title="Fold the navigation away — the handle top-left brings it back"
          >
            ⟨
          </button>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((p) => (
            <div key={p.href} className="pb-1">
              {/* the filled highlight belongs to ONE row: the parent only when
                  the active page isn't one of its listed children */}
              <Link
                href={p.href}
                className="block rounded-md px-2 py-1.5 text-sm font-medium transition-colors"
                style={
                  isActive(p) && !(p.children ?? []).some(isActive)
                    ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }
                    : { color: "var(--foreground)" }
                }
              >
                {p.label}
              </Link>
              {p.children && (
                <ul className="ml-3 border-l pl-3" style={{ borderColor: "var(--border)" }}>
                  {p.children.map((c) => (
                    <li key={c.href}>
                      <Link
                        href={c.href}
                        className="block rounded-md px-2 py-1 text-[13px] transition-colors"
                        style={
                          isActive(c)
                            ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)", fontWeight: 500 }
                            : { color: "var(--muted)" }
                        }
                      >
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
        <div className="px-2 text-[10px]" style={{ color: "var(--muted)" }}>
          Brightline Ltd · demo
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b px-5 py-2.5 backdrop-blur"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
        >
          <div className="flex min-w-0 items-center gap-4">
            {!navOpen && (
              <button
                onClick={() => toggleNav(true)}
                className="hidden rounded-md border px-2 py-1 text-sm transition-colors hover:text-[var(--accent)] md:block"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                title="Bring the navigation back"
              >
                ☰
              </button>
            )}
            <Link href="/" className={`text-sm font-semibold ${navOpen ? "md:hidden" : ""}`}>
              AgenticFinance
            </Link>
            {/* area links mirror the sidebar parents — quick jumps on wide screens */}
            <nav className="hidden items-center gap-4 overflow-x-auto text-sm md:flex">
              {NAV.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className="whitespace-nowrap transition-colors hover:underline"
                  style={parentActive(p) ? { color: "var(--accent)", fontWeight: 500 } : { color: "var(--muted)" }}
                >
                  {p.short ?? p.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => toggleAnalyst(!analystOpen)}
              className="hidden whitespace-nowrap rounded-lg border px-3 py-1 text-sm transition-colors md:block"
              style={
                analystOpen
                  ? { borderColor: "var(--accent)", color: "var(--accent)" }
                  : { borderColor: "var(--border)", color: "var(--muted)" }
              }
              title="Ask the Analyst about the numbers — read-only, answers cite their views"
            >
              Analyst
            </button>
            <CommandPalette />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1760px] px-5 py-6 lg:px-8">{children}</main>
      </div>

      {analystOpen && (
        <div className="hidden md:block">
          <AnalystPanel onClose={() => toggleAnalyst(false)} />
        </div>
      )}
    </div>
  );
}
