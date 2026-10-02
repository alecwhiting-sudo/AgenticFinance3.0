"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

export function ApplyReceiptsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/o2c/apply-receipts`, { method: "POST" });
      const d = await res.json();
      setMsg(`Applied ${d.applied}; ${d.leftovers} need investigation.`);
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
        className="min-w-[8.5rem] whitespace-nowrap rounded-lg px-3 py-1.5 text-center text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {busy ? "Applying…" : "Apply receipts"}
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}

export function ChaseButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/o2c/chase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      if (res.ok) setSent(true);
    } catch { /* state unchanged */ }
    setBusy(false);
    router.refresh();
  };
  if (sent) return <span className="text-xs" style={{ color: "var(--muted)" }}>drafting…</span>;
  return (
    <button
      disabled={busy}
      onClick={run}
      className="whitespace-nowrap rounded border px-2 py-0.5 text-xs disabled:opacity-40"
      style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
    >
      {busy ? "…" : "Chase"}
    </button>
  );
}

export function InvestigateReceiptButton({ bankTransactionId }: { bankTransactionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/o2c/investigate-receipt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bankTransactionId }),
      });
      if (res.ok) setSent(true);
    } catch { /* state unchanged */ }
    setBusy(false);
    router.refresh();
  };
  if (sent) return <span className="text-xs" style={{ color: "var(--muted)" }}>queued</span>;
  return (
    <button
      disabled={busy}
      onClick={run}
      className="rounded border px-2 py-0.5 text-xs disabled:opacity-40"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      {busy ? "…" : "Investigate"}
    </button>
  );
}
