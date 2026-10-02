"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

/** Scheduler trigger: group due posted invoices into a proposed run. */
export function ProposeRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const propose = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/p2p/payments/propose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!d.run) setMsg("Nothing due — no posted invoices inside the horizon.");
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    router.refresh();
  };
  return (
    <span className="flex items-center gap-3">
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
      <button
        disabled={busy}
        onClick={propose}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {busy ? "Scheduling…" : "Propose payment run"}
      </button>
    </span>
  );
}

/** Human checkpoint: executing a run moves money. */
export function DecideRun({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await fetch(`${apiUrl}/p2p/payments/${paymentId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approve, decidedBy: "alec" }),
      });
    } catch { /* refresh shows unchanged state */ }
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <button
        disabled={busy}
        onClick={() => decide(true)}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        Approve &amp; pay
      </button>
      <button
        disabled={busy}
        onClick={() => decide(false)}
        className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
        style={{ borderColor: "var(--border)" }}
      >
        Reject
      </button>
    </div>
  );
}

/** Hand an ambiguous bank line to the Reconciliation Agent. */
export function InvestigateButton({ bankTransactionId }: { bankTransactionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/r2r/bank/investigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankTransactionId }),
      });
      if (res.ok) setSent(true);
    } catch { /* state unchanged on refresh */ }
    setBusy(false);
    router.refresh();
  };
  if (sent) return <span className="text-xs" style={{ color: "var(--muted)" }}>queued</span>;
  return (
    <button
      disabled={busy}
      onClick={send}
      className="rounded border px-2 py-0.5 text-xs disabled:opacity-40"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      {busy ? "…" : "Investigate"}
    </button>
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
      setMsg(`Matched ${d.matched} of ${d.scanned} open lines.`);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    router.refresh();
  };
  return (
    <span className="flex items-center gap-3">
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
      <button
        disabled={busy}
        onClick={run}
        className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
        style={{ borderColor: "var(--border)" }}
      >
        {busy ? "Matching…" : "Reconcile"}
      </button>
    </span>
  );
}
