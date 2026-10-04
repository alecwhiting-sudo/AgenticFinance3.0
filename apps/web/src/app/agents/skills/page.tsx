"use client";

/** The skills library: shared, version-controlled skills, clustered by
 * finance-function topic. Master-detail: the list on the left, the selected
 * skill's full text on the right — click through skills and read them without
 * entering edit mode. Editing is an explicit step and every save is a new
 * immutable version; agents pick a new version up through a release
 * (draft → eval → promote), never silently. The library deliberately holds
 * more skills than today's agents use (controls, FP&A) — future-proofing for
 * the performance-management and controls phases. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { Badge, Button, PageHeader } from "@/components/ui";
import { SkillEditor } from "@/components/agentActions";

type Row = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  latestVersion: number;
  latestInstructions: string;
  versions: number;
  usedBy: { agentSlug: string; agentName: string; pinnedVersion: number | null; stale: boolean }[];
};

const CLUSTERS: [string, string][] = [
  ["p2p", "Procure to Pay"],
  ["o2c", "Order to Cash"],
  ["r2r", "Record to Report"],
  ["analytics", "Analytics"],
  ["controls", "Controls & audit"],
  ["fpa", "Planning & performance"],
  ["platform", "Platform"],
];

export default function SkillsLibraryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", description: "", instructions: "", category: "platform" });
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/skills`);
      if (res.ok) setRows((await res.json()) as Row[]);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const createSkill = async () => {
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/skills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, createdBy: "workbench-user" }),
      });
      const d = (await res.json()) as { error?: string; slug?: string };
      if (!res.ok) setMsg(d.error ?? "failed");
      else {
        setMsg(`Added ${form.name} (v1). Attach it to an agent from the agent's page.`);
        setAdding(false);
        setForm({ slug: "", name: "", description: "", instructions: "", category: "platform" });
        await load();
        setSelected(form.slug);
      }
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  };

  const sel = rows.find((s) => s.slug === selected) ?? null;

  // stale = some agent's active release pins an older version than the
  // latest skill text; the refresh drafts rebuilt releases from the central
  // map, evals them, and auto-promotes on a fully green suite
  const staleAgents = [...new Set(rows.flatMap((s) => s.usedBy.filter((u) => u.stale).map((u) => u.agentSlug)))];
  const [refreshing, setRefreshing] = useState(false);
  const refreshStale = async () => {
    setRefreshing(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/agents/releases/refresh-stale`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ updatedBy: "workbench-user" }),
      });
      const d = (await res.json()) as { results?: { agentSlug: string; status: string; draftVersion?: number }[]; error?: string };
      if (!res.ok) {
        setMsg(d.error ?? "refresh failed");
        setRefreshing(false);
        return;
      }
      const drafted = (d.results ?? []).filter((r) => r.draftVersion);
      setMsg(
        `${drafted.length} rebuilt release${drafted.length === 1 ? "" : "s"} drafted; evals running — each promotes itself when its suite is green. ` +
          (d.results ?? [])
            .filter((r) => r.status.includes("manual"))
            .map((r) => `${r.agentSlug}: promote manually (no eval cases).`)
            .join(" "),
      );
      // the worker promotes within seconds in demo mode — poll until clean
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        await load();
      }
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <main className="space-y-6">
      <PageHeader
        title="Skills library"
        context="Shared, version-controlled skills, clustered by topic. The library holds more than today's agents use — controls and planning skills are seeded ahead of the phases that will need them. Editing saves a new immutable version; agents adopt it through a release, never silently."
        actions={<Button variant="outline" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "New skill"}</Button>}
      />
      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}

      {staleAgents.length > 0 && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--warn)", background: "var(--card)" }}
        >
          <p className="text-sm">
            <span style={{ color: "var(--warn)" }}>Stale pins:</span>{" "}
            {staleAgents.length} agent{staleAgents.length === 1 ? "" : "s"} ({staleAgents.join(", ")}) run
            older skill versions than the latest text. Refresh drafts a rebuilt release per agent from the
            central map, runs its eval suite against the draft, and promotes it only when every eval passes.
          </p>
          <Button variant="primary" onClick={refreshStale} disabled={refreshing} title={refreshing ? "Re-enables when the refresh round finishes" : undefined}>
            {refreshing ? "Refreshing…" : "Refresh stale releases"}
          </Button>
        </div>
      )}

      {adding && (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="grid gap-3 sm:grid-cols-4">
            <input
              placeholder="slug (kebab-case)"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
            />
            <input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
            />
            <input
              placeholder="One-line description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
            />
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--background)" }}
            >
              {CLUSTERS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <textarea
            placeholder={
              "Instructions — follow the skill template (UI_CONVENTIONS §5.1):\n" +
              "## Purpose & trigger\nWhat this skill is for; which task types / situations invoke it.\n" +
              "## Inputs\nWhat the task payload provides; preconditions.\n" +
              "## Grounding — tools & data\nWhat records to pull before forming a view. The live tool list is authoritative.\n" +
              "## Method\nThe rules, decision tree, thresholds — the meat.\n" +
              "## Outputs & format\nCommands to propose; what finished work looks like; money as £ with pence.\n" +
              "## Escalation & never-do\nWhen to stop and hand to a human; hard prohibitions.\n" +
              "## Quality bar\n2-4 bullets a reviewer or the eval suite checks."
            }
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            rows={12}
            className="mt-3 w-full rounded-lg border px-3 py-2 font-mono text-xs"
            style={{ borderColor: "var(--border)", background: "var(--background)" }}
          />
          <div className="mt-3">
            <Button variant="primary" onClick={createSkill} disabled={!form.slug || !form.name || form.instructions.length < 20}>
              Create skill (v1)
            </Button>
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ---- master: clustered list ---- */}
        <div className="space-y-5">
          {CLUSTERS.map(([cat, label]) => {
            const inCat = rows.filter((s) => (s.category ?? "platform") === cat);
            if (inCat.length === 0) return null;
            return (
              <section key={cat}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  {label} <span className="font-normal">· {inCat.length}</span>
                </h3>
                <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  {inCat.map((s) => {
                    const active = selected === s.slug;
                    const stale = s.usedBy.some((u) => u.stale);
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setSelected(active ? null : s.slug);
                          setEditing(false);
                        }}
                        className="block w-full border-b px-4 py-2.5 text-left last:border-0"
                        style={{
                          borderColor: "var(--border)",
                          background: active ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                        }}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium" style={active ? { color: "var(--accent)" } : undefined}>
                            {s.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
                            {s.usedBy.length > 0 ? (
                              <span>{s.usedBy.length} agent{s.usedBy.length === 1 ? "" : "s"}</span>
                            ) : (
                              <span>unattached</span>
                            )}
                            {stale && <span style={{ color: "var(--warn)" }}>stale pin</span>}
                            <Badge>v{s.latestVersion}</Badge>
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs" style={{ color: "var(--muted)" }}>{s.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {rows.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No skills yet.</p>}
        </div>

        {/* ---- detail: the selected skill, read-first ---- */}
        <div className="lg:sticky lg:top-16">
          {!sel ? (
            <div
              className="rounded-xl border border-dashed p-8 text-center text-sm"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Select a skill to read it. Click through the list — the text shows here; Edit is a separate step.
            </div>
          ) : (
            <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="text-base font-semibold">{sel.name}</span>{" "}
                  <span className="num text-xs" style={{ color: "var(--muted)" }}>{sel.slug}</span>{" "}
                  <Badge>v{sel.latestVersion}</Badge>{" "}
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {sel.versions} version{sel.versions === 1 ? "" : "s"}
                  </span>
                </div>
                {!editing && <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
                {editing && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel edit</Button>}
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{sel.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span style={{ color: "var(--muted)" }}>Mapped into:</span>
                {sel.usedBy.length === 0 && (
                  <span style={{ color: "var(--muted)" }}>no agent mapping — seeded ahead of need</span>
                )}
                {sel.usedBy.map((u) => {
                  // pinnedVersion null = mapped centrally, but the active release
                  // hasn't picked it up yet (a draft release must be promoted).
                  const awaiting = u.pinnedVersion === null;
                  const warn = !awaiting && u.stale;
                  return (
                    <Link
                      key={u.agentSlug}
                      href={`/agents/${u.agentSlug}`}
                      className="rounded-full border px-2 py-0.5 hover:underline"
                      style={{ borderColor: warn ? "var(--warn)" : "var(--border)", color: warn ? "var(--warn)" : "var(--muted)" }}
                      title={
                        awaiting
                          ? "mapped centrally — a draft release must be promoted before the agent carries this skill"
                          : u.stale
                            ? `pinned to v${u.pinnedVersion}; latest is v${sel.latestVersion} — draft a release to pick it up`
                            : `pinned to v${u.pinnedVersion} (latest)`
                      }
                    >
                      {awaiting ? `${u.agentName} · awaiting release` : `${u.agentName} · v${u.pinnedVersion}`}
                      {warn ? " (stale)" : ""}
                    </Link>
                  );
                })}
              </div>
              {!editing ? (
                <pre
                  className="mt-3 max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed"
                  style={{ borderColor: "var(--border)", background: "var(--background)" }}
                >
                  {sel.latestInstructions}
                </pre>
              ) : (
                <div className="mt-3">
                  <SkillEditor skillSlug={sel.slug} skillName={sel.name} latestInstructions={sel.latestInstructions} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
