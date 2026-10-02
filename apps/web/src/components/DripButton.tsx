"use client";

/** The demo drip: lands a fresh invoice in the capture queue (ARCH §6b). */
import { useRouter } from "next/navigation";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const SCENARIOS = ["clean", "price_variance", "qty_short_receipt", "missing_receipt", "no_purchase", "bank_detail_change"];

export default function DripButton() {
  const router = useRouter();
  const [scenario, setScenario] = useState("clean");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      <select
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        className="rounded-lg border p-1.5 text-sm"
        style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
      >
        {SCENARIOS.map((s) => (
          <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
        ))}
      </select>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch(`${apiUrl}/p2p/drip`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ scenario }),
            });
            const data = (await res.json().catch(() => null)) as { supplier?: string } | null;
            setMsg(res.ok ? `Invoice from ${data?.supplier} landed — watch the live feed.` : "Drip failed.");
            setTimeout(() => router.refresh(), 2500);
            setTimeout(() => router.refresh(), 7000);
          } catch {
            setMsg(`Cannot reach the API at ${apiUrl} from this browser — check NEXT_PUBLIC_API_URL on the web service (needs a rebuild after changing).`);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        {busy ? "Dripping…" : "Drip invoice"}
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </div>
  );
}
