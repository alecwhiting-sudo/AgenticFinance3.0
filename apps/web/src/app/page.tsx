import Link from "next/link";
import type { CompanyOverview, Health } from "@af/shared";
import { getJson } from "@/lib/api";
import { Card, SectionTitle, Stat } from "@/components/ui";
import LiveFeed from "@/components/LiveFeed";

type AgentRow = {
  slug: string;
  name: string;
  purpose: string;
  status: string;
  activeRelease: { version: number } | null;
  totalRuns: number;
  openWorkItems: number;
};

export default async function Dashboard() {
  const [health, overview, agents] = await Promise.all([
    getJson<Health>("/health"),
    getJson<CompanyOverview>("/company/overview"),
    getJson<AgentRow[]>("/agents"),
  ]);
  const openItems = (agents ?? []).reduce((n, a) => n + a.openWorkItems, 0);

  return (
    <main className="space-y-8">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">
          {overview?.company.name ?? "No company seeded yet"}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {overview
            ? `${overview.company.code} · ${overview.company.currency} · period ${
                overview.currentPeriod?.code ?? "—"
              } (${overview.currentPeriod?.status ?? "none"})`
            : "Run the seed to bring Brightline Ltd to life."}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Agents" value={agents?.length ?? "—"} />
        <Stat label="Open work items" value={openItems} />
        <Stat label="API" value={health ? "up" : "down"} hint={health ? `v${health.version}` : "unreachable"} />
        <Stat label="Database" value={health?.db === "ok" ? "up" : "down"} />
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        <Card className="md:col-span-3">
          <SectionTitle>Live activity</SectionTitle>
          <LiveFeed />
        </Card>
        <Card className="md:col-span-2">
          <SectionTitle>Agent roster</SectionTitle>
          <ul className="space-y-3">
            {(agents ?? []).map((a) => (
              <li key={a.slug}>
                <Link href={`/agents/${a.slug}`} className="block rounded-lg p-2 -m-2 hover:bg-black/5 dark:hover:bg-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{a.name}</span>
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{
                        background: a.openWorkItems > 0 ? "var(--accent)" : "var(--border)",
                        animation: a.openWorkItems > 0 ? "breathe 2s ease-in-out infinite" : undefined,
                      }}
                    />
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {a.activeRelease ? `release v${a.activeRelease.version}` : "no active release"} ·{" "}
                    {a.totalRuns} runs · {a.openWorkItems} open
                  </div>
                </Link>
              </li>
            ))}
            {(agents ?? []).length === 0 && (
              <li className="text-sm" style={{ color: "var(--muted)" }}>No agents registered.</li>
            )}
          </ul>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Accounts" value={overview?.counts.accounts ?? "—"} />
        <Stat label="Suppliers" value={overview?.counts.suppliers ?? "—"} />
        <Stat label="Customers" value={overview?.counts.customers ?? "—"} />
        <Stat label="Items" value={overview?.counts.items ?? "—"} />
      </section>
    </main>
  );
}
