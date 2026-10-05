"use client";

/** A single board pack (plans/DATASET_V2.md PR-G, deck form PR-H/H2): the
 * reviewable product, rendered as a branded slide deck rather than a memo.
 * Every slide is the SAME fixed 16:9 canvas (1280×720 logical px) — on
 * screen the deck scales uniformly to the window; on print each slide maps
 * 1:1 onto a 16:9 landscape page in the exact theme being viewed (dark
 * prints dark), pinned for the print pass via the beforeprint hook below.
 * The agent drafts the NARRATIVE (stored sections, by id); the deck marries
 * each narrative section to a live chart from the same governed views the
 * agent read, scoped to the pack's period lens — so the visuals follow the
 * chart house rules (UI_CONVENTIONS §4.8) by construction and every figure
 * still traces to a governed view. While drafting it shows an honest WIP
 * banner (safe to leave — the row is server-side and this page is its
 * permanent address). */
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { monthEndDate, monthLabel } from "@af/shared";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { formatDate, money, moneyCompact } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { Button } from "@/components/ui";
import { AreaTrend, HBars, Waterfall } from "@/components/charts";

type Section = { id: string; heading: string; body: string; figures?: { label: string; value: string }[] };
type Pack = {
  id: string;
  label: string;
  title: string;
  status: "drafting" | "draft" | "failed";
  lensGrain: string;
  periodFrom: string;
  periodTo: string;
  sections: Section[];
  sources: string[];
  createdAt: string;
  updatedAt: string;
};

type FluxRow = { code: string; name: string; thisMinor: number; prevMinor: number; deltaMinor: number };
type Flux = { period: string; prior: string; partial: boolean; rows: FluxRow[] };
type Cash = { points: { date: string; balanceMinor: number }[] };
type Aging = {
  asOf: string;
  buckets: string[];
  totalMinor: number;
  overdueMinor: number;
  parties: { code: string; name: string; buckets: number[]; totalMinor: number; items: number }[];
};
type Live = {
  flux: Flux | null;
  cash: Cash | null;
  ap: Aging | null;
  ar: Aging | null;
  byException: Record<string, number> | null;
};

/** ledger sign is debit-positive; contribution to profit = -(movement) */
const contribution = (m: number) => -m;
const FRAUD_CODES = new Set(["bank_detail_change", "bank_detail_mismatch"]);
const KNOWN = ["exec-summary", "pnl", "cash", "working-capital", "controls"];

/** one logical canvas for every slide — PowerPoint's 16:9 at 96dpi */
const SLIDE_W = 1280;
const SLIDE_H = 720;

/* ---------- deck chrome ---------- */

/** Uniform on-screen scale: slides are authored at 1280×720 and the deck
 * container scales them to its width, so every slide keeps the same shape
 * at any window size. Print overrides the transform (scale 1) and the
 * @page size takes over. */
function useDeckScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.78);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / SLIDE_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

function SlideFrame({ scale, children }: { scale: number; children: React.ReactNode }) {
  return (
    <div className="slide-wrap overflow-hidden" style={{ height: SLIDE_H * scale }}>
      <div className="slide-scale" style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: SLIDE_W }}>
        {children}
      </div>
    </div>
  );
}

function Slide({
  n,
  total,
  kicker,
  title,
  packTitle,
  children,
}: {
  n: number;
  total: number;
  kicker: string;
  title: string;
  packTitle: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="slide relative flex flex-col overflow-hidden rounded-2xl border shadow-sm"
      style={{ width: SLIDE_W, height: SLIDE_H, borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div
        className="h-1.5 w-full shrink-0"
        style={{ background: "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 30%, transparent))" }}
      />
      <div className="flex shrink-0 items-baseline justify-between px-12 pt-7">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>
            {kicker}
          </div>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h3>
        </div>
        <div className="num text-sm" style={{ color: "var(--muted)" }}>
          {n} / {total}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-12 py-5">{children}</div>
      <div
        className="flex shrink-0 items-center justify-between border-t px-12 py-3 text-[10px] uppercase tracking-widest"
        style={{ borderColor: "var(--border)", color: "var(--muted)" }}
      >
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--accent)" }} />
          Brightline Ltd
        </span>
        <span className="truncate pl-4">{packTitle}</span>
      </div>
    </section>
  );
}

/** Commentary sized to fit its fixed box: long bodies step down a size. */
function Commentary({ body }: { body: string }) {
  const long = body.length > 650;
  return (
    <p className={`whitespace-pre-wrap ${long ? "text-xs leading-5" : "text-sm leading-7"}`}>{body}</p>
  );
}

function FigureTiles({ figures }: { figures: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 content-start gap-4">
      {figures.map((f) => (
        <div
          key={f.label}
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--accent) 4%, transparent)" }}
        >
          <div className="num text-3xl font-semibold tracking-tight">{f.value}</div>
          <div className="mt-1.5 text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {f.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function Pending({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-dashed p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
      {what} is loading from the governed views…
    </p>
  );
}

/* ---------- page ---------- */

export default function BoardPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pack, setPack] = useState<Pack | null | "missing">(null);
  const [live, setLive] = useState<Live | null>(null);
  const { ref: deckRef, scale } = useDeckScale();

  /* presenter paging: ONE slide on screen, next/prev snaps to the next one.
   * Print still lays out every slide (the offstage class only hides on
   * screen). totalRef lets the one keydown listener see the live count. */
  const [cur, setCur] = useState(0);
  const totalRef = useRef(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setCur((p) => Math.min(totalRef.current - 1, p + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCur((p) => Math.max(0, p - 1));
      } else if (e.key === "Home") setCur(0);
      else if (e.key === "End") setCur(totalRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/r2r/board-packs/${id}`);
      if (res.status === 404) return setPack("missing");
      const d = (await res.json()) as { pack: Pack };
      setPack(d.pack);
    } catch {
      /* retry on next poll */
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  const drafting = pack !== null && pack !== "missing" && pack.status === "drafting";
  useEffect(() => {
    if (!drafting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [drafting, load]);

  /* print exactly what is on screen: the app's dark mode can come from the
   * OS preference, which the print pass re-evaluates (usually to light) —
   * so pin the RESOLVED theme onto <html> for the duration of the print,
   * then restore. Covers the button and Ctrl/Cmd+P alike. */
  useEffect(() => {
    let pinned = false;
    const before = () => {
      const root = document.documentElement;
      if (root.dataset.theme) return; // explicit choice already pinned
      pinned = true;
      root.dataset.theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    const after = () => {
      if (pinned) delete document.documentElement.dataset.theme;
      pinned = false;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  // once the pack exists, pull the live charts for ITS window — one shot
  const ready = pack !== null && pack !== "missing";
  const from = ready ? pack.periodFrom : null;
  const to = ready ? pack.periodTo : null;
  useEffect(() => {
    if (!from || !to) return;
    const today = new Date().toISOString().slice(0, 10);
    const asOf = monthEndDate(to) < today ? monthEndDate(to) : today;
    const get = async <T,>(path: string): Promise<T | null> => {
      try {
        const r = await fetch(`${apiUrl}${path}`);
        return r.ok ? ((await r.json()) as T) : null;
      } catch {
        return null;
      }
    };
    void (async () => {
      const [flux, cash, ap, ar, recs] = await Promise.all([
        get<Flux>(`/analytics/flux?${from === to ? `period=${to}` : `from=${from}&to=${to}`}`),
        get<Cash>(`/analytics/cash?from=${from}&to=${to}`),
        get<Aging>(`/analytics/aging?side=ap&asOf=${asOf}`),
        get<Aging>(`/analytics/aging?side=ar&asOf=${asOf}`),
        get<{ aggregates: { by_exception: Record<string, number> | null } | null }>(
          "/analytics/records?entity=ap_invoices&status=exception&limit=1",
        ),
      ]);
      setLive({ flux, cash, ap, ar, byException: recs?.aggregates?.by_exception ?? null });
    })();
  }, [from, to]);

  if (pack === "missing")
    return (
      <main>
        Board pack not found — see <Link href="/reports/board" className="underline">Board packs</Link>.
      </main>
    );
  if (pack === null)
    return (
      <main className="text-sm" style={{ color: "var(--muted)" }}>
        Loading…
      </main>
    );

  const sec = (sid: string) => pack.sections.find((s) => s.id === sid);
  const extras = pack.sections.filter((s) => !KNOWN.includes(s.id));
  const periodText = pack.periodFrom === pack.periodTo ? monthLabel(pack.periodTo) : pack.label;
  const windowed = pack.periodFrom !== pack.periodTo;

  /* P&L waterfall: same construction as the analytics boards (top movers by
   * |contribution|, remainder folded into Other, grey period anchors) */
  const flux = live?.flux ?? null;
  const fluxItems = flux ? flux.rows.map((r) => ({ ...r, contrib: contribution(r.deltaMinor) })).filter((r) => r.contrib !== 0) : [];
  const keep = new Set(
    [...fluxItems].sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 8).map((r) => r.code),
  );
  const movers = [...fluxItems].sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 5);
  const shown = fluxItems.filter((r) => keep.has(r.code));
  const other = fluxItems.filter((r) => !keep.has(r.code)).reduce((n, r) => n + r.contrib, 0);
  const priorTotal = flux ? flux.rows.reduce((n, r) => n + contribution(r.prevMinor), 0) : 0;
  const nowTotal = flux ? flux.rows.reduce((n, r) => n + contribution(r.thisMinor), 0) : 0;

  const cashPts = (live?.cash?.points ?? []).map((x) => ({
    label: new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" }),
    value: x.balanceMinor,
  }));
  for (let j = cashPts.length - 1; j > 0; j--) if (cashPts[j]!.label === cashPts[j - 1]!.label) cashPts[j]!.label = "";
  const cashOpen = live?.cash?.points[0]?.balanceMinor ?? null;
  const cashClose = live?.cash?.points.at(-1)?.balanceMinor ?? null;

  const exc = live?.byException ?? null;
  const excRows = exc
    ? Object.entries(exc)
        .map(([code, n]) => ({ code, n }))
        .sort((a, b) => b.n - a.n)
    : [];
  const excMax = Math.max(1, ...excRows.map((r) => r.n));
  const fraudHeld = excRows.filter((r) => FRAUD_CODES.has(r.code)).reduce((n, r) => n + r.n, 0);

  const agingSlice = (a: Aging | null) =>
    (a?.parties ?? []).slice(0, 10).map((x) => ({
      label: x.name,
      segments: x.buckets,
      title: `${x.name} · ${x.items} open · ${money(x.totalMinor)}`,
    }));

  /* assemble the deck: render functions so each slide knows n of N */
  const slides: ((n: number, total: number) => React.ReactNode)[] = [];
  const S = (kicker: string, title: string, body: React.ReactNode) => {
    slides.push((n, total) => (
      <SlideFrame key={`${n}-${title}`} scale={scale}>
        <Slide n={n} total={total} kicker={kicker} title={title} packTitle={pack.title}>
          {body}
        </Slide>
      </SlideFrame>
    ));
  };

  const exec = sec("exec-summary");
  if (exec)
    S(
      "Executive summary",
      exec.heading,
      <div className="grid h-full grid-cols-2 items-center gap-10">
        {exec.figures && exec.figures.length > 0 ? <FigureTiles figures={exec.figures} /> : <div />}
        <Commentary body={exec.body} />
      </div>,
    );

  const pnl = sec("pnl");
  if (pnl)
    S(
      "Financial performance",
      pnl.heading,
      <div className="flex h-full flex-col gap-4">
        {flux ? (
          <Waterfall
            startLabel={windowed ? "Prior" : monthLabel(flux.prior).slice(0, 3)}
            start={priorTotal}
            items={[
              ...shown.map((r) => ({ label: r.name, delta: r.contrib })),
              ...(other !== 0 ? [{ label: `Other (${fluxItems.length - shown.length})`, delta: other }] : []),
            ]}
            endLabel={windowed ? periodText : monthLabel(flux.period).slice(0, 3)}
            end={nowTotal}
            height={290}
            width={1180}
          />
        ) : (
          <Pending what="The profit bridge" />
        )}
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-10 overflow-hidden">
          <table className="w-full self-start text-xs">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                <th className="py-1.5 text-left">Largest movements vs prior</th>
                <th className="py-1.5 text-right">Impact on profit</th>
              </tr>
            </thead>
            <tbody>
              {movers.map((r) => (
                <tr key={r.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1.5">{r.code} {r.name}</td>
                  <td className="num py-1.5 text-right" style={{ color: r.contrib >= 0 ? "var(--good)" : "var(--warn)" }}>
                    {r.contrib >= 0 ? "+" : ""}{money(r.contrib)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Commentary body={pnl.body} />
        </div>
      </div>,
    );

  const cash = sec("cash");
  if (cash)
    S(
      "Liquidity",
      cash.heading,
      <div className="flex h-full flex-col gap-4">
        <div className="flex shrink-0 flex-wrap gap-10">
          {cashClose != null && (
            <div>
              <div className="num text-3xl font-semibold tracking-tight">{moneyCompact(cashClose)}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Closing balance</div>
            </div>
          )}
          {cashOpen != null && cashClose != null && (
            <div>
              <div className="num text-3xl font-semibold tracking-tight" style={{ color: cashClose - cashOpen >= 0 ? "var(--good)" : "var(--warn)" }}>
                {cashClose - cashOpen >= 0 ? "+" : ""}{moneyCompact(cashClose - cashOpen)}
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Movement in period</div>
            </div>
          )}
        </div>
        {cashPts.length > 0 ? <AreaTrend points={cashPts} height={300} width={1180} /> : <Pending what="The cash curve" />}
        <div className="min-h-0 flex-1 overflow-hidden">
          <Commentary body={cash.body} />
        </div>
      </div>,
    );

  const wc = sec("working-capital");
  if (wc)
    S(
      "Working capital",
      wc.heading,
      <div className="flex h-full flex-col gap-5">
        <div className="grid shrink-0 grid-cols-2 gap-12">
          <div>
            <div className="mb-2 flex items-baseline justify-between text-xs">
              <span className="font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Receivables by age</span>
              {live?.ar && (
                <span className="num" style={{ color: "var(--muted)" }}>
                  {moneyCompact(live.ar.totalMinor)} open · {moneyCompact(live.ar.overdueMinor)} past due
                </span>
              )}
            </div>
            {live?.ar ? <HBars segmentLabels={live.ar.buckets} rows={agingSlice(live.ar)} /> : <Pending what="AR aging" />}
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between text-xs">
              <span className="font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>Payables by age</span>
              {live?.ap && (
                <span className="num" style={{ color: "var(--muted)" }}>
                  {moneyCompact(live.ap.totalMinor)} open · {moneyCompact(live.ap.overdueMinor)} past due
                </span>
              )}
            </div>
            {live?.ap ? <HBars segmentLabels={live.ap.buckets} rows={agingSlice(live.ap)} /> : <Pending what="AP aging" />}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Commentary body={wc.body} />
        </div>
      </div>,
    );

  const controls = sec("controls");
  if (controls)
    S(
      "Controls & exceptions",
      controls.heading,
      <div className="grid h-full grid-cols-2 gap-10">
        <div className="flex flex-col gap-4">
          {exc ? (
            <div className="space-y-2">
              {excRows.map((r) => (
                <div key={r.code} className="flex items-center gap-2 text-xs">
                  <span className="w-48 shrink-0 truncate" title={r.code}>{r.code.replaceAll("_", " ")}</span>
                  <span className="h-4 min-w-0 flex-1">
                    <span
                      className="block h-full rounded-sm"
                      style={{
                        width: `${(r.n / excMax) * 100}%`,
                        background: FRAUD_CODES.has(r.code) ? "var(--bad)" : "var(--accent)",
                      }}
                    />
                  </span>
                  <span className="num w-8 shrink-0 text-right" style={{ color: "var(--muted)" }}>{r.n}</span>
                </div>
              ))}
              {excRows.length === 0 && (
                <p className="text-sm" style={{ color: "var(--muted)" }}>No open invoice exceptions.</p>
              )}
            </div>
          ) : (
            <Pending what="The exception ledger" />
          )}
          {fraudHeld > 0 && (
            <div
              className="rounded-lg border p-3 text-xs"
              style={{ borderColor: "var(--bad)", background: "color-mix(in srgb, var(--bad) 6%, transparent)" }}
            >
              <span className="font-semibold" style={{ color: "var(--bad)" }}>
                {fraudHeld} invoice{fraudHeld === 1 ? "" : "s"} on fraud hold
              </span>{" "}
              — bank-detail changes and mismatches are never auto-resolved; payment waits for human verification.
            </div>
          )}
        </div>
        <Commentary body={controls.body} />
      </div>,
    );

  for (const s of extras)
    S(
      "Appendix",
      s.heading,
      <div className="grid h-full grid-cols-2 gap-10">
        {s.figures && s.figures.length > 0 ? <FigureTiles figures={s.figures} /> : <div />}
        <Commentary body={s.body} />
      </div>,
    );

  if (pack.sections.length > 0)
    S(
      "Provenance",
      "Sources & audit trail",
      <div className="max-w-4xl space-y-5 text-sm">
        <ul className="list-disc space-y-1.5 pl-5">
          {pack.sources.map((src) => (
            <li key={src} style={{ color: "var(--muted)" }}>{src}</li>
          ))}
        </ul>
        <p style={{ color: "var(--muted)" }}>
          Narrative drafted {formatDate(pack.updatedAt)} by the Board Reporting Agent from the governed
          views above — it proposes, humans approve. Charts on these slides render live from the same
          views each time the deck opens, so they stay current if the ledger moves after drafting.
        </p>
      </div>,
    );

  const total = slides.length + 1; // + cover
  totalRef.current = total;
  const page = Math.min(cur, total - 1);
  const go = (d: number) => setCur(Math.max(0, Math.min(total - 1, page + d)));

  return (
    <main className="deck-page space-y-5">
      {/* print: 16:9 landscape pages, one slide each, at the on-screen theme.
       * The @page size equals the slide canvas, the screen scale transform is
       * removed, and print-color-adjust keeps the theme backgrounds. */}
      <style>{`
        @media print {
          @page { size: ${SLIDE_W}px ${SLIDE_H}px; margin: 0; }
          aside, header, .no-print { display: none !important; }
          html, body { background: var(--card) !important; }
          main { max-width: none !important; margin: 0 !important; padding: 0 !important; }
          .deck-page > *, .deck-item { margin: 0 !important; }
          .deck-item { display: block !important; break-after: page; }
          .deck-item:last-child { break-after: auto; }
          .slide-wrap { height: ${SLIDE_H}px !important; margin: 0 !important; overflow: hidden; }
          .slide-scale { transform: none !important; }
          .slide { border: none !important; border-radius: 0 !important; box-shadow: none !important; }
          .slide, .slide * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
        @media screen { .deck-offstage { display: none; } }
      `}</style>

      <div className="no-print">
        <Breadcrumbs trail={[{ href: "/reports/board", label: "Board packs" }, { label: pack.label }]} />
      </div>

      {pack.status === "drafting" && (
        <section className="no-print rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--accent)" }} />
            The Board Reporting Agent is drafting this pack…
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            Work in progress — this page refreshes itself. You can safely leave: the draft continues
            on the server, and this page (listed under R2R → Board packs) is its permanent address.
          </p>
        </section>
      )}
      {pack.status === "failed" && (
        <section className="no-print rounded-xl border p-4 text-sm" style={{ borderColor: "var(--bad)", background: "var(--card)" }}>
          This draft failed — the run&apos;s transcript is in the{" "}
          <Link href="/work" className="underline">work queue</Link>. Draft the period again from{" "}
          <Link href="/reports/board" className="underline">Board packs</Link>.
        </section>
      )}

      {pack.status === "draft" && (
        <div className="no-print flex justify-end">
          <Button onClick={() => window.print()} variant="outline">Print / save as PDF</Button>
        </div>
      )}

      <div ref={deckRef} className="w-full">
        {/* cover — same fixed canvas as every other slide */}
        <div className={`deck-item${page === 0 ? "" : " deck-offstage"}`}>
        <SlideFrame scale={scale}>
          <section
            className="slide relative flex flex-col justify-between overflow-hidden rounded-2xl p-14 text-white shadow-sm"
            style={{ width: SLIDE_W, height: SLIDE_H, background: "linear-gradient(135deg, #0d9488 0%, #115e59 55%, #134e4a 100%)" }}
          >
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full"
              style={{ background: "radial-gradient(circle, rgba(255,255,255,0.14), transparent 65%)" }}
            />
            <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.22em] text-teal-100">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-white" />
                Brightline Ltd
              </span>
              <span>Board pack</span>
            </div>
            <div>
              <h2 className="max-w-4xl text-6xl font-semibold leading-tight tracking-tight">{pack.title}</h2>
              <p className="mt-6 inline-block rounded-full border border-white/35 px-5 py-1.5 text-base text-teal-50">
                {periodText}
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 text-sm text-teal-100">
              <span>Drafted by the Board Reporting Agent · actuals from the governed views · for human review</span>
              <span className="num">{formatDate(pack.updatedAt)} · 1 / {total}</span>
            </div>
          </section>
        </SlideFrame>
        </div>

        {slides.map((render, i) => (
          <div key={i} className={`deck-item${page === i + 1 ? "" : " deck-offstage"}`}>
            {render(i + 2, total)}
          </div>
        ))}
      </div>

      {/* presenter controls: snap between slides; ← → / PgUp PgDn / space work too */}
      <div className="no-print flex items-center justify-center gap-4">
        <Button onClick={() => go(-1)} variant="outline" disabled={page === 0}>← Previous</Button>
        <span className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              onClick={() => setCur(i)}
              aria-label={`Slide ${i + 1}`}
              className="h-2.5 w-2.5 rounded-full transition-colors"
              style={{ background: i === page ? "var(--accent)" : "color-mix(in srgb, var(--muted) 35%, transparent)" }}
            />
          ))}
        </span>
        <span className="num w-14 text-center text-sm" style={{ color: "var(--muted)" }}>
          {page + 1} / {total}
        </span>
        <Button onClick={() => go(1)} variant="outline" disabled={page === total - 1}>Next →</Button>
        <span className="hidden text-xs sm:inline" style={{ color: "var(--muted)" }}>
          ← → keys work
        </span>
      </div>

      {pack.status === "draft" && (
        <section className="no-print rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <span style={{ color: "var(--muted)" }}>
            Reads wrong? Edit the{" "}
            <Link href="/agents/skills" className="hover:underline" style={{ color: "var(--accent)" }}>
              Board pack method skill
            </Link>{" "}
            (new versions pass the eval gate first), then draft this period again — the old pack
            stays here for comparison.
          </span>
        </section>
      )}
    </main>
  );
}
