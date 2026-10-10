"use client";

/** Exceptions workbench (plans/P2P.md §10): the queue of invoices needing
 * judgement. Left: open exceptions grouped by kind. Right: the evidence —
 * approved vs received vs invoiced per line — the case timeline, and the
 * agent's grounded options as one-click resolutions. Humans decide. */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { money } from "@/lib/format";
import { Badge } from "@/components/ui";

type Row = {
  id: string;
  number: string;
  invoice_date: string;
  gross_minor: number;
  exception_code: string;
  supplier_name: string;
  age_days: number;
  has_options: boolean;
  investigating: boolean;
};
type Option = {
  resolution: string;
  label: string;
  rationale: string;
  costedNote?: string;
  adjustedQuantities?: { lineNo: number; qty: number }[];
  emailDraft?: { to: string; subject: string; body: string };
};
type Detail = {
  invoice: { id: string; supplierInvoiceNumber: string; invoiceDate: string; grossMinor: number; exceptionCode: string; documentPath: string | null; emailPath: string | null };
  supplier: { name: string } | null;
  purchase: { number: string; id: string; approvedBy: string | null; approvalBand: string | null } | null;
  diff: {
    lineNo: number;
    description: string;
    approvedQty: number | null;
    approvedPriceMinor: number | null;
    receivedQty: number | null;
    invoicedQty: number;
    invoicedPriceMinor: number;
    varianceMinor: number | null;
  }[];
  caseEvents: { at: string; actorType: string; actorId: string; kind: string; detail: Record<string, unknown> }[];
  options: Option[];
  supplierHistory: { invoices: number; open_exceptions: number; paid: number };
  investigating: boolean;
  tolerances: { priceVariancePct?: number; priceVarianceFloorMinor?: number } | null;
};

const CODE_LABELS: Record<string, string> = {
  price_variance: "Price variance",
  qty_short_receipt: "Short receipt",
  missing_receipt: "Missing receipt",
  no_purchase: "No purchase record",
  duplicate_suspect: "Duplicate suspect",
  bank_detail_change: "Bank detail change (fraud risk)",
  bank_detail_mismatch: "IBAN mismatch vs master (fraud risk)",
  total_mismatch: "Stated total ≠ line sum",
};

export default function ExceptionsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/p2p/exceptions`);
      if (res.ok) {
        const r = (await res.json()) as Row[];
        setRows(r);
        setSel((cur) => cur && r.some((x) => x.id === cur) ? cur : (r[0]?.id ?? null));
      }
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/p2p/exceptions/${id}`);
      if (res.ok) setD((await res.json()) as Detail);
    } catch { /* list poll shows the error */ }
  }, []);

  useEffect(() => { void loadList(); const t = setInterval(loadList, 4000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => { if (sel) void loadDetail(sel); else setD(null); }, [sel, loadDetail]);
  // refresh the open detail while an investigation runs
  useEffect(() => {
    if (!sel || !d?.investigating) return;
    const t = setInterval(() => void loadDetail(sel), 3000);
    return () => clearInterval(t);
  }, [sel, d?.investigating, loadDetail]);

  const investigate = async () => {
    if (!sel) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/p2p/exceptions/${sel}/investigate`, { method: "POST" });
      if (!res.ok) setMsg(((await res.json()) as { error?: string }).error ?? "failed");
      else setMsg("Sent to the Invoice Exception Agent — options land on the case in a few seconds.");
    } catch { setMsg(`Cannot reach the API at ${apiUrl}.`); }
    setBusy(false);
    if (sel) await loadDetail(sel);
  };

  const apply = async (o: Option) => {
    if (!sel) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/p2p/exceptions/${sel}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resolution: o.resolution,
          rationale: o.rationale,
          adjustedQuantities: o.adjustedQuantities,
          decidedBy: "workbench-user",
        }),
      });
      const body = (await res.json()) as { error?: string; result?: { status?: string } };
      setMsg(res.ok ? `Resolved: ${body.result?.status ?? "done"}.` : (body.error ?? "failed"));
    } catch { setMsg(`Cannot reach the API at ${apiUrl}.`); }
    setBusy(false);
    await loadList();
  };

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groups.get(r.exception_code) ?? [];
    g.push(r);
    groups.set(r.exception_code, g);
  }

  return (
    <main className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Exceptions workbench</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Open exceptions with the evidence side by side, the agent&apos;s proposed options, and
            resolution actions. {rows.length} open.
          </p>
        </div>
        <Link href="/p2p" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--border)" }}>
          ← P2P
        </Link>
      </section>
      {msg && <p className="text-sm" style={{ color: "var(--muted)" }}>{msg}</p>}

      <section className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          {[...groups.entries()].map(([code, list]) => (
            <div key={code}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {CODE_LABELS[code] ?? code} · {list.length}
              </h3>
              <div className="space-y-1.5">
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setSel(r.id); setMsg(null); }}
                    className="block w-full rounded-lg border p-2.5 text-left text-sm"
                    style={{ borderColor: sel === r.id ? "var(--accent)" : "var(--border)", background: "var(--card)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{r.supplier_name}</span>
                      <span className="tabular-nums">{money(r.gross_minor)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
                      <span>{r.number} · {r.age_days}d old</span>
                      <span>{r.investigating ? "agent working…" : r.has_options ? "options ready" : ""}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No open exceptions — run a scenario on the <Link href="/test" className="hover:underline" style={{ color: "var(--accent)" }}>Test panel</Link> to raise some.
            </p>
          )}
        </div>

        {d ? (
          <div className="space-y-4">
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">
                  {d.supplier?.name} · {d.invoice.supplierInvoiceNumber}{" "}
                  <Badge tone="warn">{CODE_LABELS[d.invoice.exceptionCode] ?? d.invoice.exceptionCode}</Badge>
                </h3>
                <span className="text-lg font-semibold tracking-tight">{money(d.invoice.grossMinor)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs" style={{ color: "var(--muted)" }}>
                <span>invoiced {d.invoice.invoiceDate}</span>
                {d.purchase && (
                  <span>
                    against <Link href={`/p2p/purchases/${d.purchase.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>{d.purchase.number}</Link>
                    {d.purchase.approvedBy ? ` (approved by ${d.purchase.approvedBy})` : ""}
                  </span>
                )}
                <span>
                  supplier history: {d.supplierHistory.invoices} invoices, {d.supplierHistory.paid} paid, {d.supplierHistory.open_exceptions} open exceptions
                </span>
                {d.invoice.documentPath && (
                  <a href={`${apiUrl}/${d.invoice.documentPath}`} target="_blank" className="hover:underline" style={{ color: "var(--accent)" }}>invoice PDF ↗</a>
                )}
                {d.invoice.emailPath && (
                  <a href={`${apiUrl}/${d.invoice.emailPath}`} target="_blank" className="hover:underline" style={{ color: "var(--accent)" }}>covering email ↗</a>
                )}
              </div>

              {/* the 3-way diff: approved vs received vs invoiced */}
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                    <th className="py-1.5">Line</th>
                    <th className="py-1.5 text-right">Approved</th>
                    <th className="py-1.5 text-right">Received</th>
                    <th className="py-1.5 text-right">Invoiced</th>
                    <th className="py-1.5 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {d.diff.map((l) => (
                    <tr key={l.lineNo} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1.5">{l.description}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.approvedQty !== null ? `${l.approvedQty} × ${money(l.approvedPriceMinor!)}` : <span style={{ color: "var(--bad)" }}>no purchase</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums" style={l.receivedQty !== null && l.receivedQty < l.invoicedQty ? { color: "var(--warn)" } : undefined}>
                        {l.receivedQty !== null ? l.receivedQty : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{l.invoicedQty} × {money(l.invoicedPriceMinor)}</td>
                      <td className="py-1.5 text-right tabular-nums" style={l.varianceMinor ? { color: l.varianceMinor > 0 ? "var(--bad)" : "var(--good)" } : undefined}>
                        {l.varianceMinor !== null && l.varianceMinor !== 0 ? money(l.varianceMinor) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* the agent's options */}
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                  Resolution options {d.options.length > 0 && `(${d.options.length}, agent-proposed)`}
                </h4>
                <button
                  disabled={busy || d.investigating}
                  onClick={investigate}
                  className="rounded-lg border px-3 py-1 text-xs disabled:opacity-40"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                >
                  {d.investigating ? "agent working…" : d.options.length ? "Re-investigate" : "Ask the agent for options"}
                </button>
              </div>
              {d.options.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  No options on the case yet — ask the agent, or resolve from the invoice page.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {d.options.map((o, i) => (
                    <div
                      key={i}
                      className="flex flex-col rounded-lg border p-3"
                      style={{ borderColor: o.resolution === "human_verify" ? "var(--warn)" : "var(--border)" }}
                    >
                      <div className="text-sm font-medium">{o.label}</div>
                      {o.costedNote && <div className="mt-0.5 text-xs font-medium" style={{ color: "var(--warn)" }}>{o.costedNote}</div>}
                      <p className="mt-1 flex-1 text-xs leading-5" style={{ color: "var(--muted)" }}>{o.rationale}</p>
                      {o.emailDraft && (
                        <details className="mt-2 rounded-lg border p-2 text-xs" style={{ borderColor: "var(--border)" }}>
                          <summary className="cursor-pointer font-medium" style={{ color: "var(--accent)" }}>
                            Draft supplier email — never sent automatically
                          </summary>
                          <div className="mt-2 space-y-1" style={{ color: "var(--muted)" }}>
                            <div><span className="font-medium">To:</span> {o.emailDraft.to}</div>
                            <div><span className="font-medium">Subject:</span> {o.emailDraft.subject}</div>
                            <pre className="mt-1 whitespace-pre-wrap font-sans leading-5">{o.emailDraft.body}</pre>
                          </div>
                        </details>
                      )}
                      {o.resolution === "human_verify" ? (
                        <span className="mt-2 text-xs font-medium" style={{ color: "var(--warn)" }}>
                          guidance only — requires out-of-band verification
                        </span>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => apply(o)}
                          className="mt-2 self-start whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                          style={{ background: "var(--accent)" }}
                        >
                          Apply — {o.resolution.replace(/_/g, " ")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {d.tolerances && (
                <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                  Tolerance policy (parameter set, versioned): price variances within{" "}
                  {d.tolerances.priceVariancePct ?? 2}% of the approved purchase or{" "}
                  {money(d.tolerances.priceVarianceFloorMinor ?? 2500)}, whichever is larger, are recommended for
                  acceptance — every resolution still needs a human approval.
                </p>
              )}
            </div>

            {/* case timeline */}
            <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Case timeline</h4>
              <ol className="space-y-1.5 text-sm">
                {d.caseEvents.map((e, i) => (
                  <li key={i}>
                    <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
                      {new Date(e.at).toLocaleString()} · {e.actorId}
                    </span>{" "}
                    {e.kind === "options"
                      ? `attached ${((e.detail as { options?: unknown[] }).options ?? []).length} resolution options`
                      : String((e.detail as { note?: string; detail?: string; rationale?: string }).note ?? (e.detail as { detail?: string }).detail ?? (e.detail as { rationale?: string }).rationale ?? e.kind)}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border p-6 text-sm" style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--muted)" }}>
            Select an exception.
          </div>
        )}
      </section>
    </main>
  );
}
