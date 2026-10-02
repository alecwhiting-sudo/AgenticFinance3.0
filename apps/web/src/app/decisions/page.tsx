import type { Metadata } from "next";
import { getJson } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { ApiDownBanner, Breadcrumbs } from "@/components/Chrome";
import { Badge, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Decisions" };

type Decision = {
  id: string;
  type: string;
  status: string;
  decided_by: string;
  decision_reason: string | null;
  decided_at: string;
  agent_name: string | null;
};

/** Decision history (UI_CONVENTIONS §2.4): every human yes/no on an agent
 * proposal — the audit answer to "who approved what, when, and why". */
export default async function DecisionsPage() {
  const rows = await getJson<Decision[]>("/decisions");
  return (
    <main className="space-y-5">
      <Breadcrumbs trail={[{ href: "/approvals", label: "Approvals" }, { label: "Decision history" }]} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Decision history</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Every human decision on an agent proposal. System postings under
          standing authority are on the live feed, not here.
        </p>
      </section>
      <ApiDownBanner show={rows === null} />
      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
              <th className="py-2">Command</th>
              <th className="py-2">Proposed by</th>
              <th className="py-2">Decision</th>
              <th className="py-2">By</th>
              <th className="py-2 text-right">When</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-b align-top last:border-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 font-medium">{r.type}</td>
                <td className="py-2" style={{ color: "var(--muted)" }}>{r.agent_name ?? "—"}</td>
                <td className="py-2">
                  <Badge tone={r.status === "rejected" ? "bad" : "good"}>
                    {r.status === "rejected" ? "rejected" : "approved"}
                  </Badge>
                  {r.decision_reason && (
                    <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>“{r.decision_reason}”</div>
                  )}
                </td>
                <td className="py-2">{r.decided_by}</td>
                <td className="py-2 text-right text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                  {formatDateTime(r.decided_at)}
                </td>
              </tr>
            ))}
            {rows !== null && rows.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-sm" style={{ color: "var(--muted)" }}>No human decisions yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
