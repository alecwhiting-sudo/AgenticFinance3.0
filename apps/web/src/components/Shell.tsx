"use client";

/** The app shell (UI_CONVENTIONS §1.1 v2): a fixed left sidebar for areas and
 * their sub-sections — the Mercury/Linear app idiom — with a slim top bar for
 * search. Content uses the full viewport width; centered max-width layouts
 * are a website convention, not an application one. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import CommandPalette from "@/components/CommandPalette";

type Item = { href: string; label: string; exact?: boolean };
type Group = { label: string | null; items: Item[] };

const NAV: Group[] = [
  { label: null, items: [{ href: "/", label: "Dashboard", exact: true }] },
  {
    label: "Procure to Pay",
    items: [
      { href: "/p2p", label: "Overview", exact: true },
      { href: "/p2p/purchases", label: "Purchases" },
      { href: "/p2p/invoices", label: "Invoices" },
      { href: "/p2p/exceptions", label: "Exceptions" },
      { href: "/p2p/payments", label: "Payments" },
      { href: "/p2p/flow", label: "Live flow" },
    ],
  },
  {
    label: "Order to Cash",
    items: [{ href: "/o2c", label: "Overview" }],
  },
  {
    label: "Record to Report",
    items: [
      { href: "/r2r", label: "Month end" },
      { href: "/ledger", label: "Ledger" },
      { href: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Agents",
    items: [
      { href: "/agents", label: "Roster" },
      { href: "/work", label: "Work queue" },
      { href: "/approvals", label: "Approvals" },
      { href: "/decisions", label: "Decisions" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/test", label: "Test panel" },
      { href: "/admin", label: "Admin", exact: true },
      { href: "/admin/architecture", label: "Architecture" },
    ],
  },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = (it: Item) =>
    it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + "/");

  return (
    <div className="flex min-h-screen">
      <aside
        className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col overflow-y-auto border-r px-3 py-5 md:flex"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <Link href="/" className="mb-5 px-2 text-base font-semibold tracking-tight">
          AgenticFinance
        </Link>
        <nav className="flex-1 space-y-4">
          {NAV.map((g, gi) => (
            <div key={gi}>
              {g.label && (
                <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                  {g.label}
                </div>
              )}
              <ul className="space-y-0.5">
                {g.items.map((it) => (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className="block rounded-md px-2 py-1 text-sm transition-colors"
                      style={
                        active(it)
                          ? { background: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)", fontWeight: 500 }
                          : { color: "var(--muted)" }
                      }
                    >
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="px-2 text-[10px]" style={{ color: "var(--muted)" }}>
          Brightline Ltd · demo
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          className="sticky top-0 z-20 flex items-center justify-between border-b px-5 py-2.5 backdrop-blur md:justify-end"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--background) 85%, transparent)" }}
        >
          <Link href="/" className="text-sm font-semibold md:hidden">
            AgenticFinance
          </Link>
          <CommandPalette />
        </header>
        <main className="px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
