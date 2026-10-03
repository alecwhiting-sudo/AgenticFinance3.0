"use client";

/** The app shell (UI_CONVENTIONS §1.1 v2): a fixed left sidebar carrying the
 * full navigation tree — parents as strong rows, children indented beneath —
 * plus a top bar with the area (parent) links and the command palette. Top
 * bar for areas, sidebar for the tree: the standard two-level app pattern
 * (Stripe/GitHub), not duplication. Content uses the full viewport width. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import CommandPalette from "@/components/CommandPalette";

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
  const isActive = (it: Item) =>
    it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");
  // a parent lights up for itself or any of its children
  const parentActive = (p: Parent) => isActive(p) || (p.children ?? []).some(isActive);

  return (
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r px-3 py-5 md:flex"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <Link href="/" className="mb-6 px-2 text-base font-semibold tracking-tight">
          AgenticFinance
        </Link>
        <nav className="flex-1 space-y-1">
          {NAV.map((p) => (
            <div key={p.href} className="pb-1">
              <Link
                href={p.href}
                className="block rounded-md px-2 py-1.5 text-sm font-medium transition-colors"
                style={
                  isActive(p)
                    ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)" }
                    : { color: parentActive(p) ? "var(--foreground)" : "var(--foreground)" }
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
            <Link href="/" className="text-sm font-semibold md:hidden">
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
          <CommandPalette />
        </header>
        <main className="mx-auto w-full max-w-[1760px] px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
