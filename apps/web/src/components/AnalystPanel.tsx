"use client";

/** The Analyst chat panel (plans/ANALYTICS.md M2): a persistent right-hand
 * surface for talking to the data. Questions go through the normal agent
 * queue (POST /analyst/ask -> analyst.question work item) and the panel polls
 * for the run's answer. The agent is read-only by construction — its only
 * data access is the curated views — and every answer ends with a sources
 * line naming the views it used. Conversation state lives in this browser
 * tab; the audit trail lives in the run transcript like any other agent run. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

type Msg = { role: "user" | "analyst"; text: string; outcome?: string };

const SUGGESTIONS = [
  "Why did the result move last month?",
  "Which customer is most overdue?",
  "What is our cash position?",
  "Build me a page called Cash focus with the cash position and AP aging",
];

type BoardProposal = {
  slug: string;
  title: string;
  description?: string;
  tiles: { view: string; params?: Record<string, string>; title?: string; span?: number }[];
};

/** The Analyst proposes a board as a trailing `board: {json}` line; the
 * person confirms creation here — agents propose, humans approve. */
function parseBoard(text: string): { body: string; board: BoardProposal | null } {
  const m = text.match(/\nboard:\s*(\{[\s\S]*\})\s*$/);
  if (!m) return { body: text, board: null };
  try {
    const board = JSON.parse(m[1]!) as BoardProposal;
    if (!board.slug || !board.title || !Array.isArray(board.tiles) || board.tiles.length === 0)
      return { body: text, board: null };
    return { body: text.slice(0, m.index).trimEnd(), board };
  } catch {
    return { body: text, board: null };
  }
}

export default function AnalystPanel({ onClose }: { onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setError(null);
      setBusy(true);
      setInput("");
      const history = msgs.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      setMsgs((m) => [...m, { role: "user", text: q }]);
      try {
        const res = await fetch(`${apiUrl}/analyst/ask`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: q, history }),
        });
        const d = (await res.json()) as { workItemId?: string; error?: string };
        if (!res.ok || !d.workItemId) throw new Error(d.error ?? "ask failed");
        // poll the queue for the run's answer (worker picks it up in ~1.5s)
        const started = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          const a = (await (await fetch(`${apiUrl}/analyst/answer/${d.workItemId}`)).json()) as {
            status: string;
            outcome: string | null;
            answer: string | null;
          };
          if (a.answer && a.status !== "pending" && a.status !== "running") {
            setMsgs((m) => [...m, { role: "analyst", text: a.answer!, outcome: a.outcome ?? undefined }]);
            break;
          }
          if (a.status === "failed") throw new Error(a.answer ?? "the analyst run failed");
          if (Date.now() - started > 120_000) throw new Error("timed out waiting for the answer — check the work queue");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, msgs],
  );

  const createBoard = async (board: BoardProposal) => {
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/analytics/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(board),
      });
      const d = (await res.json()) as { slug?: string; created?: boolean; error?: string };
      if (!res.ok || !d.slug) throw new Error(d.error ?? "could not create the board");
      setCreated((c) => ({ ...c, [board.slug]: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderAnswer = (text: string) => {
    const { body: withoutBoard, board } = parseBoard(text);
    const lines = withoutBoard.split("\n");
    const srcIdx = lines.findLastIndex((l) => l.trim().toLowerCase().startsWith("sources:"));
    const body = srcIdx >= 0 ? lines.filter((_, i) => i !== srcIdx).join("\n").trim() : withoutBoard;
    const sources = srcIdx >= 0 ? lines[srcIdx]!.trim() : null;
    return (
      <>
        <div className="whitespace-pre-wrap">{body}</div>
        {board && (
          <div className="mt-2 rounded-lg border p-2.5" style={{ borderColor: "var(--accent)" }}>
            <div className="text-xs font-semibold">{board.title}</div>
            <ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: "var(--muted)" }}>
              {board.tiles.map((t, i) => (
                <li key={i}>
                  · {t.title ?? t.view}
                  {t.params && Object.keys(t.params).length > 0 ? ` (${Object.entries(t.params).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}
                </li>
              ))}
            </ul>
            {created[board.slug] ? (
              <Link
                href={`/analytics/boards/${board.slug}`}
                className="mt-2 inline-block rounded-lg border px-2.5 py-1 text-xs font-medium hover:underline"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              >
                Page created — open it →
              </Link>
            ) : (
              <button
                onClick={() => void createBoard(board)}
                className="mt-2 rounded-lg px-2.5 py-1 text-xs font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                Create this page
              </button>
            )}
          </div>
        )}
        {sources && (
          <div className="mt-1.5 border-t pt-1.5 text-[10px]" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            {sources} ·{" "}
            <Link href="/analytics" className="hover:underline" style={{ color: "var(--accent)" }}>
              charts →
            </Link>
          </div>
        )}
      </>
    );
  };

  return (
    <aside
      className="sticky top-0 flex h-screen w-80 shrink-0 flex-col border-l xl:w-96"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="text-sm font-semibold">Analyst</div>
          <div className="text-[10px]" style={{ color: "var(--muted)" }}>
            read-only · answers from the curated views, with sources
          </div>
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-sm" style={{ color: "var(--muted)" }} title="Close the panel">
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Ask about the numbers — trends, variances, aging, cash. Every answer cites the views it used.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void ask(s)}
                disabled={busy}
                className="block w-full rounded-lg border px-3 py-1.5 text-left text-xs transition-colors hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-6 rounded-lg px-3 py-2" style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
              {m.text}
            </div>
          ) : (
            <div key={i} className="mr-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              {m.outcome && m.outcome !== "completed" && (
                <div className="mb-1 text-[10px] uppercase tracking-wide" style={{ color: "var(--warn)" }}>
                  {m.outcome}
                </div>
              )}
              {renderAnswer(m.text)}
            </div>
          ),
        )}
        {busy && (
          <div className="mr-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            Reading the views…
          </div>
        )}
        {error && (
          <p className="text-xs" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="border-t p-3"
        style={{ borderColor: "var(--border)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? "Waiting for the answer…" : "Ask about the numbers…"}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--background)" }}
          />
          <button
            type="submit"
            disabled={busy || input.trim().length < 3}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }}
            title={busy ? "Re-enables when the current answer arrives" : undefined}
          >
            Ask
          </button>
        </div>
      </form>
    </aside>
  );
}
