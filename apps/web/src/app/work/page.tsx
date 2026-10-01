import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";
import SubmitTask from "@/components/SubmitTask";

type Item = {
  id: string;
  type: string;
  status: string;
  priority: number;
  createdAt: string;
  completedAt: string | null;
  agent: { slug: string; name: string } | null;
};
type Run = { id: string; workItemId: string | null; outcome: string | null };

export default async function WorkPage() {
  const [items, agents, runs] = await Promise.all([
    getJson<Item[]>("/work-items"),
    getJson<{ slug: string; name: string }[]>("/agents"),
    getJson<Run[]>("/runs"),
  ]);
  const runByItem = new Map((runs ?? []).filter((r) => r.workItemId).map((r) => [r.workItemId, r.id]));

  return (
    <main className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Work</h2>
      <Card>
        <SectionTitle>Submit a task</SectionTitle>
        <SubmitTask agents={(agents ?? []).map((a) => ({ slug: a.slug, name: a.name }))} />
      </Card>
      <Card>
        <SectionTitle>Queue</SectionTitle>
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {(items ?? []).map((i) => {
            const runId = runByItem.get(i.id);
            const row = (
              <div className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-sm font-medium">{i.type}</span>{" "}
                  <Badge tone={toneForStatus(i.status)}>{i.status}</Badge>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    {i.agent?.name ?? "unassigned"} · {new Date(i.createdAt).toLocaleString()}
                  </div>
                </div>
                {runId && <span className="text-xs" style={{ color: "var(--accent)" }}>view run →</span>}
              </div>
            );
            return (
              <li key={i.id}>
                {runId ? <Link href={`/runs/${runId}`} className="block hover:opacity-80">{row}</Link> : row}
              </li>
            );
          })}
          {(items ?? []).length === 0 && (
            <li className="py-2 text-sm" style={{ color: "var(--muted)" }}>Queue is empty.</li>
          )}
        </ul>
      </Card>
    </main>
  );
}
