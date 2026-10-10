import Link from "next/link";
import { getJson } from "@/lib/api";
import { Badge, Card, SectionTitle, toneForStatus } from "@/components/ui";
import {
  DraftReleaseButton,
  LatestSkillVersions,
  ManageSkills,
  PromoteButton,
  RunEvalsButton,
  SkillEditor,
} from "@/components/agentActions";
import ShadowReplayPanel from "@/components/ShadowReplay";

type Detail = {
  agent: { id: string; slug: string; name: string; purpose: string; owner: string; status: string };
  releases: {
    id: string;
    version: number;
    status: string;
    modelProfile: string;
    maxModelCalls: number;
    maxCostMinor: number;
    commandPermissions: string[];
    instructions: string;
    createdBy: string;
    promotedBy: string | null;
    promotedAt: string | null;
    notes: string | null;
  }[];
  skills: { id: string; slug: string; name: string; description: string }[];
  skillVersions: { id: string; skillId: string; version: number; instructions: string }[];
  evalCases: { id: string; name: string }[];
  evalRuns: {
    id: string;
    status: string;
    passed: number;
    failed: number;
    startedAt: string;
    results: { name?: string; passed?: boolean; failures?: string[]; runId?: string }[];
  }[];
  recentRuns: { id: string; outcome: string | null; resultSummary: string | null; startedAt: string; modelCalls: number }[];
  history: { period: string; items: number; tokens: number; costCents: number; evalPassed: number | null; evalFailed: number | null }[];
  stats: {
    completed: number;
    handed_back: number;
    failed: number;
    total: number;
    tokens: number;
    openWorkItems: number;
    escalationRate: number | null;
    tokensPerCompleted: number | null;
    latestEval: { passed: number; failed: number; status: string; at: string } | null;
  } | null;
};

export default async function AgentDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await getJson<Detail>(`/agents/${slug}`);
  if (!d) return <main>Agent not found.</main>;

  const active = d.releases.find((r) => r.status === "active");
  const latestVersionPerSkill = d.skills.map(
    (s) => d.skillVersions.filter((v) => v.skillId === s.id).sort((a, b) => b.version - a.version)[0],
  );

  return (
    <main className="space-y-6">
      <LatestSkillVersions ids={latestVersionPerSkill.filter(Boolean).map((v) => v!.id)} />
      <section className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{d.agent.name}</h2>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: "var(--muted)" }}>
            {d.agent.purpose}
          </p>
        </div>
        <Badge tone={toneForStatus(d.agent.status)}>{d.agent.status}</Badge>
      </section>

      {/* Staff-record strip (UI_CONVENTIONS §2.1): the agent as a member of
          staff — workload, track record, cost, latest appraisal. */}
      {d.stats && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { v: d.stats.openWorkItems, l: "in queue now" },
            { v: d.stats.completed, l: "cases completed" },
            { v: d.stats.escalationRate !== null ? `${d.stats.escalationRate}%` : "—", l: "handed to humans" },
            { v: d.stats.failed, l: "failed runs" },
            {
              v: d.stats.tokensPerCompleted !== null ? `${(d.stats.tokensPerCompleted / 1000).toFixed(1)}k` : "0",
              l: "tokens / completed case",
            },
            {
              v: d.stats.latestEval ? `${d.stats.latestEval.passed}/${d.stats.latestEval.passed + d.stats.latestEval.failed}` : "—",
              l: "latest eval score",
            },
          ].map((s) => (
            <Card key={s.l} className="!p-3 text-center">
              <div className="text-xl font-semibold tracking-tight">{s.v}</div>
              <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{s.l}</div>
            </Card>
          ))}
        </section>
      )}

      {d.history.length > 0 && (
        <Card>
          <SectionTitle>Performance over time — tokens priced on the current rate card; eval summaries survive history flushes</SectionTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="py-2">Period</th>
                <th className="py-2 text-right">Items</th>
                <th className="py-2 text-right">Tokens</th>
                <th className="py-2 text-right">Est. cost</th>
                <th className="py-2 text-right">Cost / item</th>
                <th className="py-2 text-right">Eval pass rate</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((h) => (
                <tr key={h.period} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5 tabular-nums">{h.period}</td>
                  <td className="py-1.5 text-right tabular-nums">{h.items}</td>
                  <td className="py-1.5 text-right tabular-nums">{(h.tokens / 1000).toFixed(1)}k</td>
                  <td className="py-1.5 text-right tabular-nums">${(h.costCents / 100).toFixed(2)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {h.items > 0 ? `$${(h.costCents / 100 / h.items).toFixed(3)}` : "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {h.evalPassed !== null
                      ? `${h.evalPassed}/${(h.evalPassed ?? 0) + (h.evalFailed ?? 0)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Skills (from the <Link href="/agents/skills" className="hover:underline" style={{ color: "var(--accent)" }}>library</Link> · edit → new version)</SectionTitle>
            {active && (
              <ManageSkills
                agentSlug={d.agent.slug}
                currentSkillSlugs={d.skills.map((s) => s.slug)}
              />
            )}
          </div>
          <div className="space-y-5">
            {d.skills.map((s) => {
              const latest = d.skillVersions
                .filter((v) => v.skillId === s.id)
                .sort((a, b) => b.version - a.version)[0];
              return (
                <div key={s.id}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      latest v{latest?.version ?? "—"}
                    </span>
                  </div>
                  <SkillEditor
                    skillSlug={s.slug}
                    skillName={s.name}
                    latestInstructions={latest?.instructions ?? ""}
                  />
                </div>
              );
            })}
            {d.skills.length === 0 && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>No skills attached.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Releases</SectionTitle>
            {active && (
              <DraftReleaseButton
                agentSlug={d.agent.slug}
                base={{
                  instructions: active.instructions,
                  commandPermissions: active.commandPermissions,
                  modelProfile: active.modelProfile,
                  maxModelCalls: active.maxModelCalls,
                  maxCostMinor: active.maxCostMinor,
                }}
              />
            )}
          </div>
          {/* Release pipeline (UI_CONVENTIONS §2.3): draft → evaluated →
              active, with eval evidence attached to the stage it gates. */}
          <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs" style={{ color: "var(--muted)" }}>
            {["draft", "evaluated", "active"].map((stage, i) => {
              const n = d.releases.filter((r) => r.status === stage).length;
              return (
                <div key={stage} className="rounded-lg border px-2 py-1.5" style={{ borderColor: n > 0 ? "var(--accent)" : "var(--border)" }}>
                  <span className="font-medium" style={{ color: n > 0 ? "var(--accent)" : undefined }}>
                    {i > 0 && "→ "}{stage}
                  </span>{" "}
                  <span className="tabular-nums">{n}</span>
                  {stage === "evaluated" && <div className="mt-0.5">eval suite gates promotion</div>}
                  {stage === "draft" && <div className="mt-0.5">edit skills / model</div>}
                  {stage === "active" && <div className="mt-0.5">one live release</div>}
                </div>
              );
            })}
          </div>
          <ul className="space-y-3">
            {d.releases.map((r) => {
              const releaseEval = d.evalRuns.find((er) => er.status !== "running");
              return (
                <li key={r.id} className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: r.status === "active" ? "var(--accent)" : "var(--border)" }}>
                  <div>
                    <div className="text-sm font-medium">
                      v{r.version} <Badge tone={toneForStatus(r.status)}>{r.status}</Badge>
                      {r.status === "active" && releaseEval && (
                        <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                          evals {releaseEval.passed}/{releaseEval.passed + releaseEval.failed}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
                      model {r.modelProfile} · ≤{r.maxModelCalls} calls · permissions: {r.commandPermissions.join(", ") || "none"}
                      {r.promotedBy ? ` · promoted by ${r.promotedBy}` : ` · by ${r.createdBy}`}
                    </div>
                  </div>
                  {(r.status === "draft" || r.status === "evaluated") && (
                    <PromoteButton agentSlug={d.agent.slug} version={r.version} />
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      {/* Shadow replay (governance M2): measured impact of a draft before
          promotion — the report sits beside the pipeline it informs. */}
      <section>
        <Card>
          <ShadowReplayPanel
            agentSlug={d.agent.slug}
            draftVersions={d.releases.filter((r) => r.status === "draft").map((r) => r.version)}
          />
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle>Evals ({d.evalCases.length} cases)</SectionTitle>
            <RunEvalsButton agentSlug={d.agent.slug} />
          </div>
          <ul className="space-y-3">
            {d.evalRuns.map((er) => (
              <li key={er.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between text-sm">
                  <span>
                    <Badge tone={toneForStatus(er.status)}>{er.status}</Badge>{" "}
                    <span className="tabular-nums">{er.passed} passed / {er.failed} failed</span>
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(er.startedAt).toLocaleString()}
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--muted)" }}>
                  {er.results.map((r, i) => (
                    <li key={i}>
                      {r.passed ? "✓" : "✗"}{" "}
                      {r.runId ? (
                        <Link href={`/runs/${r.runId}`} className="hover:underline">{r.name}</Link>
                      ) : (
                        r.name
                      )}
                      {!r.passed && r.failures?.length ? ` — ${r.failures.join("; ")}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {d.evalRuns.length === 0 && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>No eval runs yet.</p>
            )}
          </ul>
        </Card>

        <Card>
          <SectionTitle>Recent runs</SectionTitle>
          <ul className="space-y-2">
            {d.recentRuns.map((r) => (
              <li key={r.id} className="text-sm">
                <Link href={`/runs/${r.id}`} className="hover:underline">
                  <Badge tone={toneForStatus(r.outcome ?? "running")}>{r.outcome ?? "running"}</Badge>{" "}
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(r.startedAt).toLocaleString()} · {r.modelCalls} model calls
                  </span>
                  <div className="truncate text-xs" style={{ color: "var(--muted)" }}>
                    {r.resultSummary ?? "…"}
                  </div>
                </Link>
              </li>
            ))}
            {d.recentRuns.length === 0 && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>No runs yet.</p>
            )}
          </ul>
        </Card>
      </section>
    </main>
  );
}
