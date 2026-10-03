"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PUBLIC_API_URL } from "@/lib/api";

type Hit = { kind: string; id: string; label: string; sub: string };

const hrefFor = (h: Hit): string => {
  switch (h.kind) {
    case "purchase": return `/p2p/purchases/${h.id}`;
    case "invoice": return `/p2p/invoices/${h.id}`;
    case "supplier": return `/suppliers/${h.id}`;
    case "agent": return `/agents/${h.id}`;
    case "account": return `/ledger/${h.id}`;
    default: return "/";
  }
};

const KIND_ICON: Record<string, string> = {
  purchase: "PO",
  invoice: "INV",
  supplier: "SUP",
  agent: "AGT",
  account: "A/C",
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${PUBLIC_API_URL}/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          setHits((await res.json()) as Hit[]);
          setActive(0);
        }
      } catch {
        setHits([]);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const go = useCallback(
    (h: Hit) => {
      setOpen(false);
      router.push(hrefFor(h));
    },
    [router],
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        title="Search (⌘K)"
      >
        Search <kbd className="ml-1 rounded border px-1" style={{ borderColor: "var(--border)" }}>⌘K</kbd>
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        Search <kbd className="ml-1 rounded border px-1" style={{ borderColor: "var(--border)" }}>⌘K</kbd>
      </button>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[18vh]"
        onClick={() => setOpen(false)}
      >
        <div
          className="w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && hits[active]) go(hits[active]);
            }}
            placeholder="Search purchases, invoices, suppliers, agents, accounts…"
            className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <ul className="max-h-72 overflow-y-auto py-1">
            {hits.map((h, i) => (
              <li key={`${h.kind}-${h.id}`}>
                <button
                  onClick={() => go(h)}
                  onMouseEnter={() => setActive(i)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm"
                  style={{ background: i === active ? "var(--background)" : "transparent" }}
                >
                  <span
                    className="w-9 shrink-0 rounded border px-1 py-0.5 text-center text-[10px] font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                  >
                    {KIND_ICON[h.kind] ?? h.kind}
                  </span>
                  <span className="truncate font-medium">{h.label}</span>
                  <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--muted)" }}>{h.sub}</span>
                </button>
              </li>
            ))}
            {q.trim().length >= 2 && hits.length === 0 && (
              <li className="px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>No matches.</li>
            )}
            {q.trim().length < 2 && (
              <li className="px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>
                Type at least two characters. ↑↓ to move, Enter to open.
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}
