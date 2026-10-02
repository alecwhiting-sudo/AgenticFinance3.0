"use client";

/** Close Agent flux commentary (plans/R2R.md §5): always shown as a draft;
 * one click asks the agent to (re)write it from the live figures. The panel
 * has its own period selector and, on first load, jumps to wherever the most
 * recent draft lives — navigating away and back never "loses" a draft. */
import { useCallback, useEffect, useRef, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type Row = { periodCode: string; text: string; draftedBy: string; createdAt: string } | null;

export default function Commentary({ period, months }: { period: string; months: string[] }) {
  const [selected, setSelected] = useState(period);
  const [row, setRow] = useState<Row>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const checkedLatest = useRef(false);

  const fetchFor = useCallback(async (p: string): Promise<Row | undefined> => {
    try {
      const res = await fetch(`${apiUrl}/r2r/commentary?period=${p}`);
      if (!res.ok) return undefined;
      setErr(null);
      return ((await res.json()) as { commentary: Row }).commentary;
    } catch {
      setErr(`Cannot reach the API at ${apiUrl} — any saved draft is still there.`);
      return undefined;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selected) return;
      const c = await fetchFor(selected);
      if (cancelled) return;
      if (c !== undefined) setRow(c);
      // First load with nothing for the default period: jump to the most
      // recent draft wherever it lives, so returning visitors see their work.
      if (c === null && !checkedLatest.current) {
        checkedLatest.current = true;
        try {
          const res = await fetch(`${apiUrl}/r2r/commentary/latest`);
          if (res.ok) {
            const latest = ((await res.json()) as { commentary: Row }).commentary;
            if (latest && !cancelled) {
              setSelected(latest.periodCode);
              setRow(latest);
            }
          }
        } catch { /* err already surfaced by fetchFor */ }
      }
    })();
    return () => { cancelled = true; };
  }, [selected, fetchFor]);

  const draft = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/r2r/commentary/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodCode: selected }),
      });
      if (!res.ok) {
        setMsg(((await res.json()) as { error?: string }).error ?? "failed");
        setBusy(false);
        return;
      }
      setMsg("Close Agent drafting…");
      const before = row?.createdAt;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const c = await fetchFor(selected);
        if (c && c.createdAt !== before) {
          setRow(c);
          setMsg(null);
          setBusy(false);
          return;
        }
      }
      setMsg("Still drafting — it saves in the background; check back shortly.");
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
  };

  if (!period) return null;
  const options = months.includes(selected) ? months : [...months, selected];

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Commentary
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded border p-1 text-xs normal-case"
            style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            {options.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {row && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] normal-case" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
              Draft — {row.draftedBy}
            </span>
          )}
        </h3>
        <span className="flex flex-col items-end gap-1">
          <button
            disabled={busy}
            onClick={draft}
            className="min-w-[13rem] whitespace-nowrap rounded-lg border px-3 py-1.5 text-center text-sm disabled:opacity-40"
            style={{ borderColor: "var(--border)" }}
          >
            {busy ? "Drafting…" : row ? "Redraft with Close Agent" : "Draft with Close Agent"}
          </button>
          {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
        </span>
      </div>
      {err && <p className="mt-3 text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
      {!err && (row ? (
        <p className="mt-3 text-sm leading-6">{row.text}</p>
      ) : (
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          No commentary for {selected} yet — the Close Agent drafts the month&apos;s story
          from the statements; a human reviews before it goes anywhere.
        </p>
      ))}
    </section>
  );
}
