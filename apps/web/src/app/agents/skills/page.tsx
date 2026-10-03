"use client";

/** The skills library: skills are shared assets, version-controlled; agents
 * reference them through releases. This page is the library's home — browse,
 * see which agents use each skill (and whether their pin is stale), edit
 * (every save is a new immutable version), and add new skills. Attaching a
 * skill to an agent happens on the agent's page, because that is a release
 * change (draft → eval → promote). */
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
  latestVersion: number;
  latestInstructions: string;
  versions: number;
  usedBy: { agentSlug: string; agentName: string; pinnedVersion: number; stale: boolean }[];
};

export default function SkillsLibraryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", description: "", instructions: "" });
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
        setForm({ slug: "", name: "", description: "", instructions: "" });
        await load();
      }
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  };

  return (
    <main className="space-y-6">
      <PageHeader
        title="Skills library"
        context="Shared, version-controlled skills. Editing saves a new immutable version; agents pick up a new version through a release (draft → eval → promote), never silently."
        actions={<Button variant="outline" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "New skill"}</Button>}
      />
      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}

      {adding && (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="grid gap-3 sm:grid-cols-3">
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
          </div>
          <textarea
            placeholder="Instructions (markdown) — what this skill teaches the agent to do"
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            rows={6}
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

      <div className="space-y-3">
        {rows.map((s) => (
          <div key={s.id} className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="text-sm font-semibold">{s.name}</span>{" "}
                <span className="num text-xs" style={{ color: "var(--muted)" }}>{s.slug}</span>{" "}
                <Badge>v{s.latestVersion}</Badge>{" "}
                <span className="text-xs" style={{ color: "var(--muted)" }}>{s.versions} version{s.versions === 1 ? "" : "s"}</span>
              </div>
              <Button variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>
                {open === s.id ? "Close" : "Edit"}
              </Button>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{s.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span style={{ color: "var(--muted)" }}>Used by:</span>
              {s.usedBy.length === 0 && <span style={{ color: "var(--muted)" }}>no active release — unattached</span>}
              {s.usedBy.map((u) => (
                <Link
                  key={u.agentSlug}
                  href={`/agents/${u.agentSlug}`}
                  className="rounded-full border px-2 py-0.5 hover:underline"
                  style={{ borderColor: u.stale ? "var(--warn)" : "var(--border)", color: u.stale ? "var(--warn)" : "var(--muted)" }}
                  title={u.stale ? `pinned to v${u.pinnedVersion}; latest is v${s.latestVersion} — draft a release to pick it up` : `pinned to v${u.pinnedVersion} (latest)`}
                >
                  {u.agentName} · v{u.pinnedVersion}{u.stale ? " (stale)" : ""}
                </Link>
              ))}
            </div>
            {open === s.id && (
              <div className="mt-3">
                <SkillEditor skillSlug={s.slug} skillName={s.name} latestInstructions={s.latestInstructions} />
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm" style={{ color: "var(--muted)" }}>No skills yet.</p>}
      </div>
    </main>
  );
}
