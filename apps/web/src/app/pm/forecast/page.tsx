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

/** A version's reasoning, readable: headline first, bullets as a list, and
 * anything long folded behind "Full reasoning" — never a wall of text.
 * Handles both bullet-formatted notes and older single-paragraph ones. */
function VersionNotes({ notes }: { notes: string }) {
  const [open, setOpen] = useState(false);
  // split into headline + bullet lines; "•" mid-text (older notes) also breaks
  const lines = notes
    .split(/\n|(?=•\s)/g)
    .map((l) => l.trim())
    .filter(Boolean);
  const headline = lines[0] ?? "";
  const rest = lines.slice(1);
  const long = headline.length > 220 || rest.length > 0;
  return (
    <div className="mt-0.5 max-w-3xl text-xs" style={{ color: "var(--muted)" }}>
      <p className={open ? "" : "line-clamp-2"}>{headline}</p>
      {open && rest.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {rest.map((l, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0" style={{ color: "var(--accent)" }}>
                •
              </span>
              <span>{l.replace(/^•\s*/, "")}</span>
            </li>
          ))}
        </ul>
      )}
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-1 text-xs hover:underline" style={{ color: "var(--accent)" }}>
          {open ? "Hide the reasoning" : `Full reasoning${rest.length > 0 ? ` (${rest.length} points)` : ""} →`}
        </button>
      )}
    </div>
  );
}

const gbp = (minor: number) =>
  `£${(Math.abs(minor) / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}${minor < 0 ? " loss" : ""}`;

type ScenarioResult = {
  asOf: string;
  changed: Record<string, { from: number; to: number }>;
  budgetFY: { revenueMinor: number; resultMinor: number };
  scenarioLanding: { revenueMinor: number; resultMinor: number };
  forecastLanding: { code: string; revenueMinor: number; resultMinor: number } | null;
  savedCode?: string;
};

/** What-if (plans/PM.md M4): nudge drivers, see the full-year landing move
 * — same maths as the forecast, so the comparison is honest. Saving keeps
 * the scenario in the version list for the record. */
function WhatIf({ drivers, onSaved }: { drivers: Driver; onSaved: () => Promise<void> }) {
  const base = Object.fromEntries(
    Object.entries(drivers.assumptions).filter(([k, v]) => k !== "workingDays" && typeof v === "number"),
  ) as Record<string, number>;
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(k.endsWith("Minor") ? v / 100 : v)])),
  );
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialog = useDialog();

  const overrides = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const minor = k.endsWith("Minor") ? Math.round(n * 100) : n;
      if (minor !== base[k]) out[k] = minor;
    }
    return out;
  };

  const run = async (saveLabel?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${apiUrl}/pm/scenario`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overrides: overrides(), ...(saveLabel ? { saveLabel } : {}) }),
      });
      const d = (await res.json()) as ScenarioResult & { error?: string };
      if (!res.ok) setErr(d.error ?? "failed");
      else {
        setResult(d);
        if (d.savedCode) await onSaved();
      }
    } catch {
      setErr(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
  };

  const save = async () => {
    const label = await dialog.ask({
      title: "Save this scenario",
      body: "A short name for the version list — e.g. “Utilisation down 5 points”.",
      placeholder: "e.g. Utilisation down 5 points",
    });
    if (!label) return;
    await run(label);
  };

  const delta = (a: number, b: number) => {
    const d = a - b;
    return (
      <span style={{ color: d === 0 ? "var(--muted)" : d > 0 ? "var(--good)" : "var(--bad)" }}>
        {d >= 0 ? "+" : "−"}{gbp(Math.abs(d))}
      </span>
    );
  };

  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          What-if
        </h4>
        <span className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => run()}
            className="rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-40"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            Recompute landing
          </button>
          <button
            disabled={busy || !result}
            onClick={save}
            className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Save as scenario…
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        Change a driver, recompute: the full-year landing is actuals to date plus the rest of the year on your
        adjusted assumptions at each account&apos;s recent run-rate.
      </p>
      <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {Object.keys(base).map((k) => (
          <label key={k} className="flex items-center justify-between gap-2 text-xs">
            <span style={{ color: "var(--muted)" }}>{k.replace(/Minor$/, " (£)")}</span>
            <input
              value={values[k] ?? ""}
              onChange={(e) => setValues((s) => ({ ...s, [k]: e.target.value }))}
              className="w-24 rounded border bg-transparent px-2 py-1 text-right font-mono tabular-nums"
              style={{
                borderColor:
                  Number(values[k]) !== (k.endsWith("Minor") ? base[k]! / 100 : base[k]) ? "var(--accent)" : "var(--border)",
              }}
            />
          </label>
        ))}
      </div>
      {err && <p className="mt-2 text-xs" style={{ color: "var(--bad)" }}>{err}</p>}
      {result && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-lg font-semibold tracking-tight tabular-nums">{gbp(result.budgetFY.resultMinor)}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>FY result — budget</div>
          </div>
          {result.forecastLanding && (
            <div className="rounded-lg border p-3 text-center" style={{ borderColor: "var(--border)" }}>
              <div className="text-lg font-semibold tracking-tight tabular-nums">{gbp(result.forecastLanding.resultMinor)}</div>
              <div className="text-xs" style={{ color: "var(--muted)" }}>FY landing — {result.forecastLanding.code}</div>
            </div>
          )}
          <div className="rounded-lg border p-3 text-center" style={{ borderColor: "var(--accent)" }}>
            <div className="text-lg font-semibold tracking-tight tabular-nums">{gbp(result.scenarioLanding.resultMinor)}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>
              FY landing — this scenario · vs budget {delta(result.scenarioLanding.resultMinor, result.budgetFY.resultMinor)}
              {result.forecastLanding && <> · vs forecast {delta(result.scenarioLanding.resultMinor, result.forecastLanding.resultMinor)}</>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

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

  // Ask the Forecast Preparation Agent: it reads the measured facts pack,
  // adjusts drivers only with a written reason, and its draft lands in the
  // version list below (poll briefly while it works).
  const prepare = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/pm/forecast/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const d = (await res.json()) as { asOf?: string; error?: string };
      setMsg(res.ok ? `The Forecast Preparation Agent is on it (as of ${d.asOf}) — its draft lands below in a few seconds, with its reasoning in the notes.` : (d.error ?? "failed"));
      if (res.ok) {
        let tries = 0;
        const t = setInterval(() => {
          void load();
          if (++tries >= 10) clearInterval(t);
        }, 3000);
      }
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
        <span className="flex items-center gap-2">
          <button
            disabled={busy}
            onClick={prepare}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "…" : "Ask the agent to prepare it"}
          </button>
          <button
            disabled={busy}
            onClick={draft}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            Mechanical draft only
          </button>
        </span>
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
                {v.notes && <VersionNotes notes={v.notes} />}
                <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                  created {when(v.createdAt)} by {v.createdBy}
                  {v.activatedAt ? ` · adopted ${when(v.activatedAt)} by ${v.activatedBy}` : ""}
                </div>
              </div>
              {v.status === "draft" && v.kind === "forecast" && (
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
        <WhatIf drivers={activeDrivers} onSaved={load} />
      )}

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
