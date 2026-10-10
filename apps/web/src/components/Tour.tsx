"use client";

/**
 * Guided-tour engine (plans/DEMO_SCRIPTS.md). Renders whatever lib/tours.ts
 * declares — the registry is the only thing a new milestone edits. Design
 * rules that keep it roadmap-proof:
 *  - The default highlight is the SIDEBAR LINK for the step's route, found
 *    by href — no per-page selectors to rot.
 *  - A step's optional `anchor` highlights a data-tour element when it
 *    exists; when a redesign removes it, the step still narrates and the
 *    tour walks on.
 *  - Navigation failures are survivable: if the viewer wanders (or a route
 *    moves), the card offers "take me there" instead of breaking.
 * Progress lives in localStorage, so a tour survives a reload mid-way.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TOURS, type Tour } from "@/lib/tours";

const STORE = "guided-tour"; // {"id":"full-loop","step":3}

export function startTourEvent(id: string): void {
  window.dispatchEvent(new CustomEvent("af-start-tour", { detail: id }));
}

export default function TourEngine() {
  const router = useRouter();
  const pathname = usePathname();
  const [tour, setTour] = useState<Tour | null>(null);
  const [step, setStep] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  // resume a tour after a reload; listen for the header button
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw) as { id: string; step: number };
        const t = TOURS.find((x) => x.id === s.id);
        if (t && s.step >= 0 && s.step < t.steps.length) {
          setTour(t);
          setStep(s.step);
        }
      }
    } catch {
      /* storage unavailable */
    }
    const onStart = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const t = TOURS.find((x) => x.id === id) ?? TOURS[0];
      if (!t) return;
      setTour(t);
      setStep(0);
      try {
        localStorage.setItem(STORE, JSON.stringify({ id: t.id, step: 0 }));
      } catch {
        /* ignore */
      }
      if (t.steps[0] && window.location.pathname !== t.steps[0].route) {
        window.location.assign(t.steps[0].route); // full nav also resets scroll
      }
    };
    window.addEventListener("af-start-tour", onStart);
    return () => window.removeEventListener("af-start-tour", onStart);
  }, []);

  const current = tour?.steps[step] ?? null;
  const onRoute = current !== null && pathname === current.route;

  // highlight: the in-page anchor when present, else the sidebar nav link.
  // Client pages render their data late, so the anchor is retried a few
  // times before settling on the nav fallback — and a missing anchor is
  // never an error, just a plainer step.
  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!current || !onRoute) return;
    let cancelled = false;
    let tries = 0;
    const apply = (target: HTMLElement, isAnchor: boolean) => {
      const prev = { boxShadow: target.style.boxShadow, borderRadius: target.style.borderRadius, transition: target.style.transition };
      target.style.transition = "box-shadow 0.3s";
      target.style.boxShadow = "0 0 0 2px var(--accent), 0 0 0 7px color-mix(in srgb, var(--accent) 20%, transparent)";
      if (!target.style.borderRadius) target.style.borderRadius = "8px";
      if (isAnchor) target.scrollIntoView({ block: "center", behavior: "smooth" });
      cleanupRef.current = () => {
        target.style.boxShadow = prev.boxShadow;
        target.style.borderRadius = prev.borderRadius;
        target.style.transition = prev.transition;
      };
    };
    const attempt = () => {
      if (cancelled) return;
      const anchorEl = current.anchor
        ? document.querySelector<HTMLElement>(`[data-tour="${current.anchor}"]`)
        : null;
      if (anchorEl) {
        cleanupRef.current?.();
        apply(anchorEl, true);
        return;
      }
      if (tries === 0) {
        const navEl =
          document.querySelector<HTMLElement>(`aside nav a[href="${current.route}"]`) ||
          document.querySelector<HTMLElement>(`aside a[href="${current.route}"]`);
        if (navEl) apply(navEl, false);
      }
      if (current.anchor && tries < 4) {
        tries += 1;
        setTimeout(attempt, 900);
      }
    };
    attempt();
    return () => {
      cancelled = true;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [current, onRoute, step]);

  const persist = (t: Tour, s: number) => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ id: t.id, step: s }));
    } catch {
      /* ignore */
    }
  };

  const exit = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    setTour(null);
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* ignore */
    }
  }, []);

  const go = (delta: number) => {
    if (!tour) return;
    const next = step + delta;
    if (next < 0) return;
    if (next >= tour.steps.length) {
      exit();
      return;
    }
    setStep(next);
    persist(tour, next);
    const dest = tour.steps[next]!.route;
    if (dest !== pathname) router.push(dest);
  };

  if (!tour || !current) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] rounded-xl border p-4 shadow-lg"
      style={{ borderColor: "var(--accent)", background: "var(--card)" }}
      role="dialog"
      aria-label="Guided tour"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--accent)" }}>
          {tour.name} · {step + 1} / {tour.steps.length}
        </span>
        <button onClick={exit} className="text-xs hover:underline" style={{ color: "var(--muted)" }}>
          exit tour
        </button>
      </div>
      <h3 className="mt-1 text-sm font-semibold">{current.title}</h3>
      <p className="mt-1 text-xs leading-5" style={{ color: "var(--muted)" }}>{current.body}</p>
      {current.tryIt && (
        <p className="mt-2 rounded-lg border border-dashed p-2 text-xs" style={{ borderColor: "var(--border)" }}>
          <span className="font-medium" style={{ color: "var(--accent)" }}>Try it: </span>
          {current.tryIt}
        </p>
      )}
      {!onRoute && (
        <button
          onClick={() => router.push(current.route)}
          className="mt-2 w-full rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          This step lives on {current.route} — take me there
        </button>
      )}
      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={() => go(-1)}
          disabled={step === 0}
          className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          ← Back
        </button>
        <div className="flex gap-1">
          {tour.steps.map((_, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: i === step ? "var(--accent)" : "color-mix(in srgb, var(--muted) 35%, transparent)" }}
            />
          ))}
        </div>
        <button
          onClick={() => go(1)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
          style={{ background: "var(--accent)" }}
        >
          {step === tour.steps.length - 1 ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}
