import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, toneForStatus } from "@/components/ui";

type AgentRow = {
  slug: string;
  name: string;
  purpose: string;
  owner: string;
  status: string;
  activeRelease: { version: number; modelProfile: string } | null;
  totalRuns: number;
  openWorkItems: number;
};

export default async function AgentsPage() {
  const agents = (await getJson<AgentRow[]>("/agents")) ?? [];
  return (
    <main className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Agents</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {agents.map((a) => (
          <Link key={a.slug} href={`/agents/${a.slug}`}>
            <Card className="h-full transition-transform hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.name}</span>
                <Badge tone={toneForStatus(a.status)}>{a.status}</Badge>
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
                {a.purpose}
              </p>
              <div className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
                {a.activeRelease
                  ? `release v${a.activeRelease.version} · model ${a.activeRelease.modelProfile}`
                  : "no active release"}{" "}
                · owner {a.owner} · {a.totalRuns} runs
              </div>
            </Card>
          </Link>
        ))}
        {agents.length === 0 && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No agents registered.</p>
        )}
      </div>
    </main>
  );
}
