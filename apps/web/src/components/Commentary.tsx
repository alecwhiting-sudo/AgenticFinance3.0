"use client";

/** Close Agent flux commentary (plans/R2R.md §5): always shown as a draft;
 * one click asks the agent to (re)write it from the live figures. */
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type Row = { text: string; draftedBy: string; createdAt: string } | null;

export default function Commentary({ period }: { period: string }) {
  const [row, setRow] = useState<Row>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!period) return;
    try {
      const res = await fetch(`${apiUrl}/r2r/commentary?period=${period}`);
      if (res.ok) setRow(((await res.json()) as { commentary: Row }).commentary);
    } catch { /* section hides gracefully */ }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  const draft = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/r2r/commentary/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodCode: period }),
      });
      if (!res.ok) {
        setMsg((await res.json()).error ?? "failed");
        setBusy(false);
        return;
      }
      setMsg("Close Agent drafting…");
      // poll for the saved draft while the worker runs
      const before = row?.createdAt;
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const check = await fetch(`${apiUrl}/r2r/commentary?period=${period}`);
        if (check.ok) {
          const c = ((await check.json()) as { commentary: Row }).commentary;
          if (c && c.createdAt !== before) {
            setRow(c);
            setMsg(null);
            setBusy(false);
            return;
          }
        }
      }
      setMsg("Still drafting — refresh shortly.");
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
  };

  if (!period) return null;

  return (
    <section
      className="rounded-xl border p-4"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Commentary — {period}
          {row && (
            <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] normal-case" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
              Draft — {row.draftedBy}
            </span>
          )}
        </h3>
        <span className="flex items-center gap-2">
          {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
          <button
            disabled={busy}
            onClick={draft}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
            style={{ borderColor: "var(--border)" }}
          >
            {busy ? "Drafting…" : row ? "Redraft with Close Agent" : "Draft with Close Agent"}
          </button>
        </span>
      </div>
      {row ? (
        <p className="mt-3 text-sm leading-6">{row.text}</p>
      ) : (
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          No commentary yet — the Close Agent drafts the month&apos;s story from the
          statements; a human reviews before it goes anywhere.
        </p>
      )}
    </section>
  );
}
