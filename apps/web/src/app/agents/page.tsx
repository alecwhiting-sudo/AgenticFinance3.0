import type { Metadata } from "next";
import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, toneForStatus } from "@/components/ui";
import PermissionsMatrix from "@/components/PermissionsMatrix";

export const metadata: Metadata = { title: "Agents" };

type AgentRow = {
  slug: string;
  name: string;
  purpose: string;
  owner: string;
  status: string;
  process: string;
  activeRelease: { version: number; modelProfile: string } | null;
  totalRuns: number;
  openWorkItems: number;
  month: { period: string; items: number; tokens: number; costCents: number };
};

/** Modules are families for agents (D13): the roster reads like an org chart. */
const FAMILIES: { key: string; label: string; blurb: string }[] = [
  { key: "p2p", label: "Procure to Pay", blurb: "intake, extraction, exceptions — spend approved once, straight through unless something fires" },
  { key: "o2c", label: "Order to Cash", blurb: "cash application and collections — receipts applied, overdue invoices chased" },
  { key: "r2r", label: "Record to Report", blurb: "reconciliation and the month's story — books complete and explained" },
  { key: "pm", label: "Performance Management", blurb: "budgets, forecasts and variance — coming with Phase 5" },
  { key: "platform", label: "Platform", blurb: "demo and utility agents behind the scenes" },
];

const MODEL_TIER: Record<string, string> = {
  extraction: "Haiku tier",
  default: "Sonnet tier",
  reasoning: "Opus tier",
  none: "deterministic",
};

export default async function AgentsPage() {
  const agents = (await getJson<AgentRow[]>("/agents")) ?? [];
  const byFamily = (key: string) => agents.filter((a) => (a.process ?? "platform") === key);

  return (
    <main className="space-y-8">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Agents</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          The finance staff, organised by process family. Agents propose; deterministic
          services post; humans approve anything that matters.
        </p>
      </section>

      {FAMILIES.map((f) => {
        const rows = byFamily(f.key);
        if (rows.length === 0 && f.key !== "pm") return null;
        return (
          <section key={f.key} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide">{f.label}</h3>
              <span className="text-xs" style={{ color: "var(--muted)" }}>{f.blurb}</span>
            </div>
            {rows.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>No agents yet.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((a) => (
                  <Link key={a.slug} href={`/agents/${a.slug}`}>
                    <Card className="h-full">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{a.name}</span>
                        <span className="flex shrink-0 gap-1">
                          {a.openWorkItems > 0 && <Badge tone="warn">{a.openWorkItems} queued</Badge>}
                          <Badge tone={toneForStatus(a.status)}>{a.status}</Badge>
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-5" style={{ color: "var(--muted)" }}>
                        {a.purpose}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
                        {a.activeRelease ? (
                          <>
                            <span>v{a.activeRelease.version}</span>
                            <span>{MODEL_TIER[a.activeRelease.modelProfile] ?? a.activeRelease.modelProfile}</span>
                          </>
                        ) : (
                          <span>no active release</span>
                        )}
                        <span>{a.totalRuns} runs</span>
                        <span>
                          this month: {a.month.items} items · {(a.month.tokens / 1000).toFixed(0)}k tok · ~${(a.month.costCents / 100).toFixed(2)}
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {agents.length === 0 && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>No agents registered.</p>
      )}

      <PermissionsMatrix />
    </main>
  );
}
