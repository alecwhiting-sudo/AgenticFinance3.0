"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

export function RunMonthEndButton({ period }: { period: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/r2r/month-end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ periodCode: period }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error ?? "failed");
      else setMsg(d.posted === 0 ? "Already posted — nothing new." : `Posted ${d.posted} entries.`);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    router.refresh();
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        disabled={busy}
        onClick={run}
        className="min-w-[9.5rem] whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {busy ? "Posting…" : "Run month-end"}
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}

export function ReconcileButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/p2p/bank/reconcile`, { method: "POST" });
      const d = await res.json();
      setMsg(`Posted ${d.rulesPosted ?? 0} by rule, matched ${d.matched ?? 0}.`);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    router.refresh();
  };
  return (
    <span className="flex flex-col items-end gap-1">
      <button
        disabled={busy}
        onClick={run}
        className="min-w-[6.5rem] whitespace-nowrap rounded-lg border px-3 py-1.5 text-center text-sm disabled:opacity-40"
        style={{ borderColor: "var(--border)" }}
      >
        {busy ? "Matching…" : "Reconcile"}
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}
