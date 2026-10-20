"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { useDialog } from "@/components/Dialog";

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
  const [held, setHeld] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/o2c/chase`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      if (res.ok) setSent(true);
      else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        // a disputed invoice is never chased — surface the hold, not a mystery
        if (d.error?.startsWith("dunning held")) setHeld(d.error);
      }
    } catch { /* state unchanged */ }
    setBusy(false);
    router.refresh();
  };
  if (held)
    return (
      <span className="whitespace-nowrap text-xs" style={{ color: "var(--warn)" }} title={held}>
        held — disputed
      </span>
    );
  // The Collections Agent drafts the letter, then proposes ar.dunning.send —
  // external comms always need a human, so the draft lands in Approvals.
  if (sent)
    return (
      <span className="whitespace-nowrap text-xs" style={{ color: "var(--muted)" }}>
        drafting —{" "}
        <a href="/approvals" className="hover:underline" style={{ color: "var(--accent)" }}>
          lands in Approvals →
        </a>
      </span>
    );
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

/** Raise a customer dispute on an invoice (plans/O2C.md §9 M3): the
 * Collections Agent opens the case with grounded ways forward, and the API
 * holds dunning while it is open. Crediting/re-billing stays human. */
export function DisputeButton({ invoiceId, number }: { invoiceId: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "raised" | "already">("idle");
  const dialog = useDialog();
  const run = async () => {
    const reason = await dialog.ask({
      title: `Raise a dispute on ${number}`,
      body: "What does the customer say is wrong? The Collections Agent grounds the case options in this reason, and dunning is held while the dispute is open.",
      placeholder: "e.g. day rate billed above the agreed schedule",
      multiline: true,
      confirmLabel: "Raise dispute",
    });
    if (!reason || reason.trim().length < 5) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/o2c/invoices/${invoiceId}/dispute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), raisedBy: "workbench" }),
      });
      if (res.ok) setState("raised");
      else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        if (d.error?.includes("already has an open dispute")) setState("already");
      }
    } catch { /* state unchanged */ }
    setBusy(false);
    router.refresh();
  };
  if (state === "raised")
    return (
      <span className="whitespace-nowrap text-xs" style={{ color: "var(--muted)" }}>
        disputed —{" "}
        <a href="/o2c" className="hover:underline" style={{ color: "var(--accent)" }}>
          case on O2C →
        </a>
      </span>
    );
  if (state === "already")
    return <span className="whitespace-nowrap text-xs" style={{ color: "var(--warn)" }}>already disputed</span>;
  return (
    <button
      disabled={busy}
      onClick={run}
      className="whitespace-nowrap rounded border px-2 py-0.5 text-xs disabled:opacity-40"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      {busy ? "…" : "Dispute"}
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
