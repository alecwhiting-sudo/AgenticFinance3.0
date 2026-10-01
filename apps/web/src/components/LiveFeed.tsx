"use client";

/**
 * The live activity feed (ARCHITECTURE.md §6a): subscribes to the API's SSE
 * stream and renders each event as one calm line with a subtle fade-in.
 */
import { useEffect, useRef, useState } from "react";

type Activity = {
  id: string;
  at: string;
  seq: number;
  actorType: string;
  actorId: string;
  verb: string;
  summary: string;
  objectType: string | null;
  objectId: string | null;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function LiveFeed({ limit = 12 }: { limit?: number }) {
  const [events, setEvents] = useState<Activity[]>([]);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const es = new EventSource(`${apiUrl}/activity/stream`);
    es.addEventListener("activity", (e) => {
      const row = JSON.parse((e as MessageEvent).data) as Activity;
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);
      setEvents((prev) => [row, ...prev].slice(0, limit));
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [limit]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: connected ? "var(--accent)" : "var(--border)" }}
        />
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {connected ? "live" : "connecting…"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {events.map((e) => (
          <li
            key={e.id}
            className="animate-[fadein_300ms_ease-out] text-sm leading-6"
            style={{ color: "var(--foreground)" }}
          >
            <span className="tabular-nums text-xs" style={{ color: "var(--muted)" }}>
              {new Date(e.at).toLocaleTimeString()}
            </span>{" "}
            {e.objectType === "run" && e.objectId ? (
              <a href={`/runs/${e.objectId}`} className="hover:underline">
                {e.summary}
              </a>
            ) : (
              e.summary
            )}
          </li>
        ))}
        {events.length === 0 && (
          <li className="text-sm" style={{ color: "var(--muted)" }}>
            Waiting for activity — submit a task from the Work page.
          </li>
        )}
      </ul>
    </div>
  );
}
