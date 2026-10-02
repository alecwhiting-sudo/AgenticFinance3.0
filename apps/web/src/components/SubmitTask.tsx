"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";



export default function SubmitTask({ agents }: { agents: { slug: string; name: string }[] }) {
  const router = useRouter();
  const [agentSlug, setAgentSlug] = useState(agents[0]?.slug ?? "");
  const [type, setType] = useState("hello.greet");
  const [payload, setPayload] = useState('{\n  "audience": "the board",\n  "topic": "supplier onboarding"\n}');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>Agent</span>
          <select
            value={agentSlug}
            onChange={(e) => setAgentSlug(e.target.value)}
            className="w-full rounded-lg border p-2"
            style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
          >
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>Task type</span>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg border p-2"
            style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-xs" style={{ color: "var(--muted)" }}>Payload (JSON)</span>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={4}
          className="w-full rounded-lg border p-2 font-mono text-xs"
          style={{ background: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)" }}
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          disabled={busy || !agentSlug}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            let parsed: unknown;
            try {
              parsed = JSON.parse(payload);
            } catch {
              setMsg("Payload is not valid JSON.");
              setBusy(false);
              return;
            }
            try {
              const res = await fetch(`${apiUrl}/work-items`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ type, agentSlug, payload: parsed }),
              });
              setMsg(res.ok ? "Task queued — watch the live feed." : "Submit failed.");
            } catch {
              setMsg(`Cannot reach the API at ${apiUrl} — check NEXT_PUBLIC_API_URL.`);
            }
            setBusy(false);
            setTimeout(() => router.refresh(), 2000);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {busy ? "Submitting…" : "Submit task"}
        </button>
        {msg && <span className="text-xs" style={{ color: "var(--muted)" }}>{msg}</span>}
      </div>
    </div>
  );
}
