import { getJson } from "@/lib/api";
import { Card, SectionTitle } from "@/components/ui";
import DecideCommand from "@/components/DecideCommand";

type Cmd = {
  id: string;
  type: string;
  params: Record<string, unknown>;
  createdAt: string;
  requiresApproval: boolean;
};

export default async function ApprovalsPage() {
  const proposed = (await getJson<Cmd[]>("/commands?status=proposed")) ?? [];
  return (
    <main className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">Approvals</h2>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Commands agents may not execute under standing authority wait here for a
        human decision. Money movement and material journals will always land in
        this inbox.
      </p>
      <Card>
        <SectionTitle>Awaiting decision ({proposed.length})</SectionTitle>
        <ul className="space-y-3">
          {proposed.map((c) => (
            <li key={c.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{c.type}</div>
                  <pre className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {JSON.stringify(c.params, null, 2)}
                  </pre>
                </div>
                <DecideCommand commandId={c.id} />
              </div>
            </li>
          ))}
          {proposed.length === 0 && (
            <li className="text-sm" style={{ color: "var(--muted)" }}>Nothing awaiting approval.</li>
          )}
        </ul>
      </Card>
    </main>
  );
}
