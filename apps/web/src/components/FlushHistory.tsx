"use client";

/** D14 maintenance: strip old run transcripts, prune old eval runs (their
 * summaries survive) and old activity events. Economic data never touched. */
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

export default function FlushHistory() {
  const [msg, setMsg] = useState<string | null>(null);
  const run = async () => {
    setMsg("flushing…");
    try {
      const res = await fetch(`${apiUrl}/admin/flush-history`, { method: "POST" });
      const d = (await res.json()) as { transcripts: number; evalRuns: number; activity: number };
      setMsg(`Flushed: ${d.transcripts} transcripts stripped, ${d.evalRuns} old eval runs pruned (summaries kept), ${d.activity} activity events pruned.`);
    } catch {
      setMsg(`Cannot reach the API at ${apiUrl}.`);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-3">
      <button
        onClick={run}
        className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm"
        style={{ borderColor: "var(--border)" }}
        title="Strip run transcripts >30d, prune eval runs >90d (summaries survive), prune old activity"
      >
        Flush history
      </button>
      {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
    </span>
  );
}
