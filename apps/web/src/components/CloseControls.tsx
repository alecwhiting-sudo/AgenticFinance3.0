"use client";

/** The close of the books (D13 step 3, plans/R2R.md M5): reconciliation
 * gates, then Lock (a physical snapshot — postings into the month refused
 * from that moment), then Certify (immutable). Changes afterwards are
 * restatements with a recorded reason, never edits; superseded snapshots
 * stay on the record. Every step is a named human. */
import { useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { useDialog } from "@/components/Dialog";

type Gate = { id: string; label: string; level: "hard" | "warn"; ok: boolean; detail: string };
type Snapshot = {
  id: string;
  version: number;
  status: string;
  summary: { journals?: number; resultMinor?: number; accounts?: number };
  lockedBy: string;
  lockedAt: string;
  certifiedBy: string | null;
  certifiedAt: string | null;
  supersededReason: string | null;
};
type Close = {
  period: { code: string; status: string };
  gates: Gate[];
  snapshots: Snapshot[];
  certifiedCheck: { reconciles: boolean; diffs: string[] } | null;
};

const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function CloseControls({ period }: { period: string }) {
  const [d, setD] = useState<Close | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dialog = useDialog();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/r2r/periods/${period}/close`);
      if (res.ok) setD((await res.json()) as Close);
    } catch {
      /* banner elsewhere */
    }
  }, [period]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${apiUrl}/r2r/periods/${period}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const resp = (await res.json()) as { error?: string };
      setMsg(res.ok ? okMsg : resp.error ?? "failed");
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
    setBusy(false);
    await load();
  };

  const lock = async () => {
    if (!d) return;
    const warns = d.gates.filter((g) => g.level === "warn" && !g.ok);
    const ok = await dialog.confirm({
      title: `Lock ${period}?`,
      body:
        `A physical snapshot of every account's movement and closing balance is taken, and postings into ${period} are refused from this moment. Corrections afterwards are restatements, on the record.` +
        (warns.length > 0 ? `\n\nClosing around open items:\n${warns.map((w) => `• ${w.detail}`).join("\n")}` : ""),
      confirmLabel: warns.length > 0 ? "Lock around the open items" : "Lock the period",
    });
    if (!ok) return;
    await act("lock", { lockedBy: "workbench-user", acceptWarnings: true }, `Period ${period} locked — snapshot taken. Certify when you're satisfied.`);
  };

  const certify = async () => {
    const ok = await dialog.confirm({
      title: `Certify ${period}?`,
      body: "Certification is immutable: this snapshot becomes the record of the month. Any later change is a restatement with its reason on file.",
      confirmLabel: "Certify — make it the record",
    });
    if (!ok) return;
    await act("certify", { certifiedBy: "workbench-user" }, `Period ${period} certified.`);
  };

  const restate = async () => {
    const reason = await dialog.ask({
      title: `Reopen ${period} for restatement`,
      body: "Why is the certified month being reopened? The reason lives on the superseded snapshot — restatements always carry their why.",
      placeholder: "e.g. supplier credit note received after certification",
      multiline: true,
    });
    if (!reason || reason.trim().length < 10) {
      if (reason !== null) setMsg("Not reopened: a substantive reason is required.");
      return;
    }
    await act("restate", { reason: reason.trim(), requestedBy: "workbench-user" }, `Period ${period} reopened — the next lock writes the next snapshot version.`);
  };

  if (!d) return null;
  const status = d.period.status;
  const gbp = (m?: number) => (m == null ? "—" : `£${(m / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: status === "certified" ? "var(--good)" : status === "locked" ? "var(--warn)" : "var(--muted)",
            background: "color-mix(in srgb, currentColor 12%, transparent)",
          }}
        >
          {status}
        </span>
        <span className="flex gap-2">
          {status === "open" && (
            <button disabled={busy} onClick={lock} className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>
              Lock the period…
            </button>
          )}
          {status === "locked" && (
            <>
              <button disabled={busy} onClick={certify} className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40" style={{ background: "var(--accent)" }}>
                Certify…
              </button>
              <button disabled={busy} onClick={restate} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                Reopen…
              </button>
            </>
          )}
          {status === "certified" && (
            <button disabled={busy} onClick={restate} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
              Restate…
            </button>
          )}
        </span>
      </div>

      {msg && <p className="text-xs" style={{ color: "var(--muted)" }}>{msg}</p>}

      <ul className="space-y-1 text-xs">
        {d.gates.map((g) => (
          <li key={g.id} className="flex items-baseline gap-2">
            <span style={{ color: g.ok ? "var(--good)" : g.level === "hard" ? "var(--bad)" : "var(--warn)" }}>
              {g.ok ? "✓" : g.level === "hard" ? "✗" : "⚠"}
            </span>
            <span>
              {g.label} <span style={{ color: "var(--muted)" }}>— {g.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {d.certifiedCheck && (
        <p className="text-xs font-medium" style={{ color: d.certifiedCheck.reconciles ? "var(--good)" : "var(--bad)" }}>
          {d.certifiedCheck.reconciles
            ? "Live ledger reconciles to the certified snapshot, account for account."
            : `DIVERGED from the certified snapshot: ${d.certifiedCheck.diffs.join("; ")}`}
        </p>
      )}

      {d.snapshots.length > 0 && (
        <ul className="space-y-1 border-t pt-2 text-xs" style={{ borderColor: "var(--border)" }}>
          {d.snapshots.map((snp) => (
            <li key={snp.id} className="flex flex-wrap items-baseline justify-between gap-x-3" style={{ color: "var(--muted)" }}>
              <span>
                <span className="font-mono">LRS {period} v{snp.version}</span>{" "}
                <span style={{ color: snp.status === "certified" ? "var(--good)" : snp.status === "superseded" ? "var(--muted)" : "var(--warn)" }}>
                  {snp.status}
                </span>
                {snp.supersededReason ? ` — ${snp.supersededReason}` : ""}
              </span>
              <span className="tabular-nums">
                {snp.summary.accounts ?? "—"} accts · result {gbp(snp.summary.resultMinor)} · locked {when(snp.lockedAt)} by {snp.lockedBy}
                {snp.certifiedAt ? ` · certified ${when(snp.certifiedAt)} by ${snp.certifiedBy}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
