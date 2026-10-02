"use client";

/** Client-side actions on the agent detail page: edit a skill (new version),
 * draft + promote releases, and run the eval suite. Single demo user. */
import { useRouter } from "next/navigation";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const USER = "alec";

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, data: { error: `cannot reach API at ${apiUrl}` } };
  }
}

export function SkillEditor({
  skillSlug,
  skillName,
  latestInstructions,
}: {
  skillSlug: string;
  skillName: string;
  latestInstructions: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(latestInstructions);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = text !== latestInstructions;

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        className="w-full rounded-lg border p-3 font-mono text-xs"
        style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
      />
      <div className="flex items-center gap-3">
        <button
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            const { ok, data } = await post(`/skills/${skillSlug}/versions`, {
              instructions: text,
              createdBy: USER,
            });
            setMsg(
              ok
                ? `Saved ${skillName} v${(data as { version?: number })?.version}. Draft a release to use it.`
                : "Save failed.",
            );
            setSaving(false);
            router.refresh();
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {saving ? "Saving…" : "Save as new version"}
        </button>
        {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
      </div>
    </div>
  );
}

export function DraftReleaseButton({
  agentSlug,
  base,
}: {
  agentSlug: string;
  base: {
    instructions: string;
    commandPermissions: string[];
    modelProfile: string;
    maxModelCalls: number;
    maxCostMinor: number;
  };
  }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          // Draft from the current active config, pinning each skill's LATEST version.
          const { ok, data } = await post(`/agents/${agentSlug}/releases`, {
            ...base,
            skillVersionIds: (window as unknown as { __latestSkillVersions?: string[] }).__latestSkillVersions ?? [],
            notes: "Drafted from workbench",
            createdBy: USER,
          });
          setMsg(ok ? `Draft v${(data as { version?: number })?.version} created.` : "Draft failed.");
          setBusy(false);
          router.refresh();
        }}
        className="rounded-lg border px-3 py-1.5 text-sm"
        style={{ borderColor: "var(--border)" }}
      >
        {busy ? "Drafting…" : "Draft new release (latest skills)"}
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}

export function LatestSkillVersions({ ids }: { ids: string[] }) {
  if (typeof window !== "undefined") {
    (window as unknown as { __latestSkillVersions?: string[] }).__latestSkillVersions = ids;
  }
  return null;
}

export function PromoteButton({ agentSlug, version }: { agentSlug: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await post(`/agents/${agentSlug}/releases/${version}/promote`, { promotedBy: USER });
        setBusy(false);
        router.refresh();
      }}
      className="rounded-lg px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
      style={{ background: "var(--accent)" }}
    >
      {busy ? "…" : "Promote"}
    </button>
  );
}

export function RunEvalsButton({ agentSlug }: { agentSlug: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { ok } = await post(`/agents/${agentSlug}/evals/run`, {});
          setMsg(ok ? "Suite queued — results appear below as the worker grades them." : "Could not start evals.");
          setBusy(false);
          setTimeout(() => router.refresh(), 2500);
          setTimeout(() => router.refresh(), 7000);
        }}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {busy ? "Starting…" : "Run eval suite"}
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}
