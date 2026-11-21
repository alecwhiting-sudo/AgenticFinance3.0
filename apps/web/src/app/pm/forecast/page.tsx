"use client";

/** PM M2 (plans/PM.md): the rolling forecast. "Draft" builds the mechanical
 * baseline (deterministic — actuals to date, then budget × measured
 * run-rates); "Adopt" is the human gate that makes a draft the active
 * forecast the workbench tracks against. The Forecast Preparation Agent
 * (M3) will propose better drafts; adoption stays human. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { useDialog } from "@/components/Dialog";

type Version = {
  id: string;
  kind: string;
  code: string;
  label: string;
  status: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
};
type Driver = { id: string; code: string; version: number; label: string; status: string; assumptions: Record<string, unknown> };

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function ForecastPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/pm/versions`);
      if (res.ok) {
        const d = (await res.json()) as { versions: Version[]; drivers: Driver[] };
        setVersions(d.versions);
        setDrivers(d.drivers);
      }
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const draft = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/pm/forecast/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const d = (await res.json()) as { version?: Version; lines?: number; error?: string };
      setMsg(res.ok ? `${d.version?.code} drafted — ${d.lines} lines: actuals to date, then budget × measured run-rates. Review below, then adopt.` : (d.error ?? "failed"));
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    await load();
  };

  const adopt = async (v: Version) => {
    const ok = await dialog.confirm({
      title: `Adopt ${v.code} as the active forecast?`,
      body: "The workbench tracks actuals against the active forecast; any previously active forecast is superseded. Adoption is recorded with your name — agents can only ever draft.",
      confirmLabel: "Adopt forecast",
    });
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/pm/versions/${v.id}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activatedBy: "workbench-user" }),
      });
      const d = (await res.json()) as { version?: Version; error?: string };
      setMsg(res.ok ? `${d.version?.code} is now the active forecast — see it on the Performance page.` : (d.error ?? "failed"));
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    await load();
  };

  const chip = (status: string) => (
    <span
      className="rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
      style={{
        color: status === "active" ? "var(--good)" : status === "draft" ? "var(--warn)" : "var(--muted)",
        background: "color-mix(in srgb, currentColor 12%, transparent)",
      }}
    >
      {status}
    </span>
  );

  const activeDrivers = drivers.find((d) => d.status === "active");

  return (
    <main className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Forecast</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Draft a rolling forecast — actuals to date, then budget adjusted by recent run-rates — review it, and
            adopt it when you're happy. Track against it on{" "}
            <Link href="/pm?vs=forecast" className="hover:underline" style={{ color: "var(--accent)" }}>
              Performance →
            </Link>
          </p>
        </div>
        <button
          disabled={busy}
          onClick={draft}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {busy ? "…" : "Draft rolling forecast"}
        </button>
      </section>
      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}

      <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Plan versions
        </h4>
        <ul className="space-y-2.5">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start justify-between gap-2 border-t pt-2.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{v.code}</span>
                  {chip(v.status)}
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{v.kind}</span>
                </div>
                <div className="mt-0.5 text-sm">{v.label}</div>
                {v.notes && <div className="mt-0.5 max-w-2xl text-xs" style={{ color: "var(--muted)" }}>{v.notes}</div>}
                <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                  created {when(v.createdAt)} by {v.createdBy}
                  {v.activatedAt ? ` · adopted ${when(v.activatedAt)} by ${v.activatedBy}` : ""}
                </div>
              </div>
              {v.status === "draft" && v.kind !== "budget" && (
                <button
                  disabled={busy}
                  onClick={() => adopt(v)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                >
                  Adopt — make active
                </button>
              )}
            </li>
          ))}
          {versions.length === 0 && <li className="text-sm" style={{ color: "var(--muted)" }}>No plan versions yet — the budget seeds on deploy.</li>}
        </ul>
      </section>

      {activeDrivers && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Active drivers — {activeDrivers.code} v{activeDrivers.version}
          </h4>
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(activeDrivers.assumptions)
              .filter(([k]) => k !== "workingDays")
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b py-1" style={{ borderColor: "var(--border)" }}>
                  <span style={{ color: "var(--muted)" }}>{k}</span>
                  <span className="font-mono tabular-nums">
                    {k.endsWith("Minor") ? `£${(Number(v) / 100).toLocaleString("en-GB")}` : String(v)}
                  </span>
                </div>
              ))}
          </div>
          <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
            Every budget line derives from these named assumptions. Changes create a new driver-set version, so every
            plan can always say which assumptions built it.
          </p>
        </section>
      )}
    </main>
  );
}
