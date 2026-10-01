"use client";

/** Live run transcript: polls the run until it finishes, rendering each step
 * as it lands — the "look inside the agent's head" view (ARCHITECTURE.md §6a). */
import { useEffect, useState } from "react";
import { Badge, toneForStatus } from "@/components/ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Step = { at: string; kind: string; label: string; detail: Record<string, unknown> };
type RunDetail = {
  run: {
    id: string;
    transcript: Step[];
    outcome: string | null;
    resultSummary: string | null;
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    startedAt: string;
    finishedAt: string | null;
  };
  agent: { name: string; slug: string } | null;
  release: { version: number; modelProfile: string } | null;
};

const kindIcon: Record<string, string> = {
  note: "·",
  model_call: "◆",
  tool_call: "⚙",
  command: "→",
  outcome: "●",
};

export default function RunViewer({ runId }: { runId: string }) {
  const [data, setData] = useState<RunDetail | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`${apiUrl}/runs/${runId}`, { cache: "no-store" });
        if (res.ok) {
          const d = (await res.json()) as RunDetail;
          setData(d);
          if (d.run.finishedAt) return; // done — stop polling
        }
      } catch {
        // retry on next tick
      }
      if (!stopped) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (!data) return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading run…</p>;
  const { run, agent, release } = data;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {agent?.name ?? "Agent"} · run
          </h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            release v{release?.version} · {run.modelCalls} model calls · {run.inputTokens + run.outputTokens} tokens
          </p>
        </div>
        <Badge tone={toneForStatus(run.outcome ?? "running")}>
          {run.outcome ?? "running…"}
        </Badge>
      </div>

      <ol className="relative space-y-3 border-l pl-5" style={{ borderColor: "var(--border)" }}>
        {run.transcript.map((s, i) => (
          <li key={i} className="animate-[fadein_300ms_ease-out]">
            <span
              className="absolute -left-[9px] inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--accent)" }}
            >
              {kindIcon[s.kind] ?? "·"}
            </span>
            <div className="text-sm font-medium">{s.label}</div>
            <div className="text-xs tabular-nums" style={{ color: "var(--muted)" }}>
              {new Date(s.at).toLocaleTimeString()} · {s.kind}
            </div>
            {Object.keys(s.detail ?? {}).length > 0 && (
              <pre
                className="mt-1 max-h-48 overflow-auto rounded-lg border p-2 text-xs"
                style={{ background: "var(--background)", borderColor: "var(--border)" }}
              >
                {JSON.stringify(s.detail, null, 2)}
              </pre>
            )}
          </li>
        ))}
        {run.transcript.length === 0 && (
          <li className="text-sm" style={{ color: "var(--muted)" }}>Waiting for the first step…</li>
        )}
      </ol>

      {run.resultSummary && (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="mb-1 text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>Result</div>
          <p className="text-sm leading-6">{run.resultSummary}</p>
        </div>
      )}
    </div>
  );
}
