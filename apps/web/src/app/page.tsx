import type { CompanyOverview, Health } from "@af/shared";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export default async function Dashboard() {
  const [health, overview] = await Promise.all([
    getJson<Health>("/health"),
    getJson<CompanyOverview>("/company/overview"),
  ]);

  const apiUp = health !== null;
  const dbUp = health?.db === "ok";

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
        <Card label="Accounts" value={overview?.counts.accounts ?? "—"} />
        <Card label="Suppliers" value={overview?.counts.suppliers ?? "—"} />
        <Card label="Customers" value={overview?.counts.customers ?? "—"} />
        <Card label="Items" value={overview?.counts.items ?? "—"} />
      </section>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Agents" value={0} hint="roster arrives in Phase 1" />
        <Card label="Open work items" value={0} hint="queue arrives in Phase 1" />
        <Card
          label="API"
          value={apiUp ? "up" : "down"}
          hint={apiUp ? `v${health!.version}` : "unreachable"}
        />
        <Card
          label="Database"
          value={dbUp ? "up" : "down"}
          hint={dbUp ? "postgres" : "unavailable"}
        />
      </section>

      <footer className="pt-4 text-xs" style={{ color: "var(--muted)" }}>
        Phase 0 skeleton — the live activity feed, agent roster and process
        views land in Phase 1.
      </footer>
    </main>
  );
}
