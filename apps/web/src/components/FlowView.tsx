"use client";

/**
 * The P2P process flow view (ARCHITECTURE.md §6a) — the signature demo
 * screen. Invoice chips sit in stage columns; when an SSE activity event
 * touches the pipeline we refetch the snapshot, diff statuses, and glow the
 * chips that moved. Motion only where something real happened.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type Invoice = {
  id: string;
  supplierName: string;
  supplierInvoiceNumber: string;
  grossMinor: number;
  status: string;
  exceptionCode: string | null;
};

const STAGES: { key: string; label: string; hint: string }[] = [
  { key: "captured", label: "Captured", hint: "extracted from the document" },
  { key: "matched", label: "Matched", hint: "3-way match passed" },
  { key: "posted", label: "Posted", hint: "journal in the GL" },
  { key: "scheduled", label: "Scheduled", hint: "in a payment run" },
  { key: "paid", label: "Paid", hint: "settled & reconciled" },
];

const P2P_VERBS =
  /dripped_invoice|captured_invoice|posted_straight_through|raised_exception|resolved_exception|proposed_payment_run|approved_payment_run|rejected_payment_run|executed_command/;

const money = (minor: number) => `£${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export default function FlowView() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [moved, setMoved] = useState<Set<string>>(new Set());
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const statuses = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/p2p/invoices?limit=60`);
      if (!res.ok) return;
      const rows = (await res.json()) as Invoice[];
      const changed = new Set<string>();
      for (const r of rows) {
        const prev = statuses.current.get(r.id);
        if (prev !== undefined && prev !== r.status) changed.add(r.id);
        statuses.current.set(r.id, r.status);
      }
      setInvoices(rows);
      if (changed.size > 0) {
        setMoved(changed);
        setTimeout(() => setMoved(new Set()), 2500);
      }
    } catch {
      /* banner elsewhere; the flow just stays still */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const es = new EventSource(`${apiUrl}/activity/stream`);
    es.addEventListener("activity", (e) => {
      const row = JSON.parse((e as MessageEvent).data) as { verb: string; summary: string };
      if (!P2P_VERBS.test(row.verb)) return;
      setLastEvent(row.summary);
      void refresh();
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [refresh]);

  const inStage = (s: string) => invoices.filter((i) => i.status === s);
  const exceptions = invoices.filter((i) => i.status === "exception");

  const chip = (i: Invoice, warn = false) => (
    <Link
      key={i.id}
      href={`/p2p/invoices/${i.id}`}
      className="block rounded-lg border px-2.5 py-1.5 text-xs transition-shadow"
      style={{
        borderColor: moved.has(i.id) ? "var(--accent)" : "var(--border)",
        background: "var(--card)",
        boxShadow: moved.has(i.id) ? "0 0 0 2px var(--accent)" : "none",
        animation: moved.has(i.id) ? "fadein 300ms ease-out" : undefined,
      }}
    >
      <div className="truncate font-medium">{i.supplierInvoiceNumber}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2" style={{ color: "var(--muted)" }}>
        <span className="truncate">{i.supplierName}</span>
        <span className="shrink-0 tabular-nums">{money(i.grossMinor)}</span>
      </div>
      {warn && i.exceptionCode && (
        <div className="mt-0.5 truncate" style={{ color: "var(--bad)" }}>{i.exceptionCode}</div>
      )}
    </Link>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: connected ? "var(--accent)" : "var(--border)" }}
        />
        {connected ? "live" : "connecting…"}
        {lastEvent && <span className="animate-[fadein_300ms_ease-out] truncate">· {lastEvent}</span>}
      </div>

      <div className="grid grid-cols-5 gap-3">
        {STAGES.map((s, idx) => {
          const rows = inStage(s.key);
          return (
            <div key={s.key} className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  {idx > 0 && <span className="mr-1">→</span>}
                  {s.label}
                </span>
                <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>{rows.length}</span>
              </div>
              <div
                className="max-h-[60vh] space-y-2 overflow-y-auto rounded-xl border p-2"
                style={{ borderColor: "var(--border)", background: "var(--background)" }}
              >
                {rows.slice(0, 30).map((i) => chip(i))}
                {rows.length === 0 && (
                  <div className="px-1 py-2 text-xs" style={{ color: "var(--muted)" }}>—</div>
                )}
              </div>
              <div className="mt-1 px-1 text-[10px]" style={{ color: "var(--muted)" }}>{s.hint}</div>
            </div>
          );
        })}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--bad)" }}>
            ↳ Exception lane — agent investigating, human decides
          </span>
          <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>{exceptions.length}</span>
        </div>
        <div
          className="grid max-h-[30vh] grid-cols-2 gap-2 overflow-y-auto rounded-xl border p-2 sm:grid-cols-4 lg:grid-cols-6"
          style={{ borderColor: "var(--bad)", background: "var(--background)" }}
        >
          {exceptions.slice(0, 24).map((i) => chip(i, true))}
          {exceptions.length === 0 && (
            <div className="px-1 py-2 text-xs" style={{ color: "var(--muted)" }}>
              No open exceptions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
