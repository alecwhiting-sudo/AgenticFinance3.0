"use client";

/** The period lens (plans/DATASET_V2.md PR-B): one control, used on every
 * page that shows figures — month / quarter / YTD, or "All" for the page's
 * native default. The selection lives in the URL (`?lens=`) so links share
 * it, and in localStorage so it follows you between pages. */
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  lensForGrain,
  monthLabel,
  parsePeriodLens,
  quarterOfMonth,
  type PeriodGrain,
} from "@af/shared";

const GRAINS: { id: PeriodGrain | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "ytd", label: "YTD" },
];

export default function PeriodPicker({
  periods,
  lens,
}: {
  /** every month code with postings, ascending */
  periods: string[];
  /** the current lens from the URL, if any */
  lens?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const resolved = parsePeriodLens(lens);
  const latest = periods[periods.length - 1];

  // the lens follows you between pages: a bare URL picks up the stored one
  useEffect(() => {
    if (lens) return;
    try {
      const stored = localStorage.getItem("periodLens");
      if (stored && stored !== "all" && parsePeriodLens(stored))
        router.replace(`${pathname}?lens=${encodeURIComponent(stored)}`);
    } catch {
      /* storage unavailable */
    }
  }, [lens, pathname, router]);

  const apply = (next: string | null) => {
    try {
      localStorage.setItem("periodLens", next ?? "all");
    } catch {
      /* storage unavailable */
    }
    router.push(next ? `${pathname}?lens=${encodeURIComponent(next)}` : pathname);
  };

  const setGrain = (g: PeriodGrain | "all") => {
    if (g === "all") return apply(null);
    // keep the anchor month when switching grain; default to the latest
    const anchor = resolved && periods.includes(resolved.to) ? resolved.to : latest;
    if (!anchor) return;
    apply(lensForGrain(g, anchor));
  };

  const grain = resolved?.grain ?? "all";
  const options =
    grain === "month"
      ? periods.map((p) => ({ value: p, label: monthLabel(p) }))
      : grain === "quarter"
        ? [...new Set(periods.map(quarterOfMonth))].map((q) => {
            const r = parsePeriodLens(q)!;
            return { value: r.lens, label: r.label };
          })
        : grain === "ytd"
          ? periods.map((p) => ({ value: `ytd@${p}`, label: `YTD ${monthLabel(p)}` }))
          : [];

  if (periods.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex overflow-hidden rounded-lg border text-xs"
        style={{ borderColor: "var(--border)" }}
        role="group"
        aria-label="Period grain"
      >
        {GRAINS.map((g) => (
          <button
            key={g.id}
            onClick={() => setGrain(g.id)}
            className="px-2.5 py-1 transition-colors"
            style={
              grain === g.id
                ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontWeight: 500 }
                : { color: "var(--muted)" }
            }
          >
            {g.label}
          </button>
        ))}
      </div>
      {resolved && (
        <select
          value={resolved.lens}
          onChange={(e) => apply(e.target.value)}
          className="rounded-lg border px-2 py-1 text-xs"
          style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          aria-label="Period"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
