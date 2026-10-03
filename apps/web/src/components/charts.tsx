"use client";

/** Chart primitives (UI_CONVENTIONS §4.7, plans/ANALYTICS.md M1). Inline SVG,
 * no charting dependency: thin marks, one axis, theme tokens via CSS vars.
 * Colour by job — sequential = the accent teal ramp; diverging (waterfall) =
 * teal favourable ↔ amber adverse, grey anchors; status badge tones are never
 * series colours. Exact figures live in each chart's table view (ChartCard
 * toggle) and in native hover titles; charts carry the shape. */
import Link from "next/link";
import { useState } from "react";
import { money, moneyCompact } from "@/lib/format";

/* ---------- shared helpers ---------- */

/** Sequential teal ramp position i of n: strongest first, fading toward the
 * muted ink — readable in both themes because both ends are theme tokens. */
export const ramp = (i: number, n: number): string =>
  n <= 1 ? "var(--accent)" : `color-mix(in srgb, var(--accent) ${Math.round(100 - (i / (n - 1)) * 72)}%, var(--muted))`;

const FAV = "var(--accent)";
const ADV = "var(--warn)";
const GREY = "color-mix(in srgb, var(--muted) 55%, transparent)";

const niceTicks = (min: number, max: number): number[] => {
  if (min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 3)));
  const s = span / step > 7 ? step * 2 : span / step < 3 ? step / 2 : step;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / s) * s; t <= max; t += s) ticks.push(t);
  return ticks.slice(0, 8);
};

const monthShort = (period: string): string =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" });

/* ---------- card with chart/table toggle ---------- */

/** Every chart has a table view (§4.7) and says where it drills. */
export function ChartCard({
  title,
  question,
  controls,
  table,
  children,
}: {
  title: string;
  question: string;
  controls?: React.ReactNode;
  table: React.ReactNode;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<"chart" | "table">("chart");
  return (
    <div className="rounded-xl border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{question}</p>
        </div>
        <div className="flex items-center gap-2">
          {controls}
          <div className="flex rounded-lg border text-xs" style={{ borderColor: "var(--border)" }}>
            {(["chart", "table"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="rounded-md px-2 py-1 capitalize"
                style={mode === m ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)" } : { color: "var(--muted)" }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3">{mode === "chart" ? children : <div className="max-h-80 overflow-y-auto">{table}</div>}</div>
    </div>
  );
}

/* ---------- multi-line trend ---------- */

export type TrendSeries = { label: string; values: (number | null)[]; href?: string };

export function TrendChart({
  months,
  series,
  height = 220,
}: {
  months: string[];
  series: TrendSeries[];
  height?: number;
}) {
  const W = 640;
  const H = height;
  const padL = 66;
  const padB = 20;
  const padT = 8;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (all.length === 0 || months.length === 0)
    return <p className="text-sm" style={{ color: "var(--muted)" }}>No activity to chart yet.</p>;
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const x = (i: number) => padL + (months.length === 1 ? (W - padL) / 2 : (i / (months.length - 1)) * (W - padL - 8));
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const ticks = niceTicks(min, max);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" className="num">
              {moneyCompact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <text key={m} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {monthShort(m)}
          </text>
        ))}
        {series.map((s, si) => {
          const pts = s.values
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(" ");
          return (
            <g key={s.label}>
              <polyline points={pts} fill="none" stroke={ramp(si, series.length)} strokeWidth="1.5" />
              {s.values.map((v, i) =>
                v == null ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill={ramp(si, series.length)}>
                    <title>{`${s.label} · ${months[i]} · ${money(v)}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s, si) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: ramp(si, series.length) }} />
            {s.href ? (
              <Link href={s.href} className="hover:underline" style={{ color: "var(--muted)" }}>
                {s.label} →
              </Link>
            ) : (
              <span style={{ color: "var(--muted)" }}>{s.label}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- waterfall (flux) ---------- */

export type WaterfallItem = { label: string; delta: number; href?: string };

/** Start anchor → signed contribution bars → end anchor. delta is already in
 * "contribution to profit" terms: positive = favourable (teal), negative =
 * adverse (amber). Anchors are grey — they are totals, not movements. */
export function Waterfall({
  startLabel,
  start,
  items,
  endLabel,
  end,
  height = 240,
}: {
  startLabel: string;
  start: number;
  items: WaterfallItem[];
  endLabel: string;
  end: number;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const padL = 66;
  const padB = 44;
  const padT = 8;
  const cols = items.length + 2;
  const running: number[] = [start];
  for (const it of items) running.push(running[running.length - 1]! + it.delta);
  const lo = Math.min(0, start, end, ...running);
  const hi = Math.max(0, start, end, ...running);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const bw = Math.min(34, ((W - padL) / cols) * 0.62);
  const cx = (i: number) => padL + ((i + 0.5) / cols) * (W - padL);
  const ticks = niceTicks(lo, hi);
  const bar = (i: number, from: number, to: number, fill: string, label: string, title: string, href?: string) => {
    const rect = (
      <rect x={cx(i) - bw / 2} y={Math.min(y(from), y(to))} width={bw} height={Math.max(1.5, Math.abs(y(from) - y(to)))} fill={fill} rx="2">
        <title>{title}</title>
      </rect>
    );
    return (
      <g key={i}>
        {href ? <Link href={href}>{rect}</Link> : rect}
        <text
          x={cx(i)}
          y={H - padB + 12}
          textAnchor="end"
          fontSize="8.5"
          fill="var(--muted)"
          transform={`rotate(-35 ${cx(i)} ${H - padB + 12})`}
        >
          {label.length > 16 ? `${label.slice(0, 15)}…` : label}
        </text>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" className="num">
            {moneyCompact(t)}
          </text>
        </g>
      ))}
      {bar(0, 0, start, GREY, startLabel, `${startLabel} · ${money(start)}`)}
      {items.map((it, i) =>
        bar(
          i + 1,
          running[i]!,
          running[i + 1]!,
          it.delta >= 0 ? FAV : ADV,
          it.label,
          `${it.label} · ${it.delta >= 0 ? "favourable" : "adverse"} ${money(it.delta)}`,
          it.href,
        ),
      )}
      {bar(cols - 1, 0, end, GREY, endLabel, `${endLabel} · ${money(end)}`)}
    </svg>
  );
}

/* ---------- horizontal bars: ranked + stacked ---------- */

export type HBarRow = { label: string; segments: number[]; href?: string; title?: string };

/** Horizontal bars, one row per entity. One segment = ranked bars; several =
 * stacked (e.g. aging buckets), coloured by the sequential ramp in segment
 * order. Values are minor units. */
export function HBars({
  rows,
  segmentLabels,
  max,
}: {
  rows: HBarRow[];
  segmentLabels?: string[];
  max?: number;
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.segments.reduce((a, b) => a + b, 0)));
  const nSeg = Math.max(1, ...rows.map((r) => r.segments.length));
  if (rows.length === 0) return <p className="text-sm" style={{ color: "var(--muted)" }}>Nothing open.</p>;
  return (
    <div className="space-y-1.5">
      {segmentLabels && segmentLabels.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]" style={{ color: "var(--muted)" }}>
          {segmentLabels.map((l, i) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: ramp(i, segmentLabels.length) }} />
              {l}
            </span>
          ))}
        </div>
      )}
      {rows.map((r) => {
        const total = r.segments.reduce((a, b) => a + b, 0);
        return (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-36 shrink-0 truncate" title={r.label}>
              {r.href ? (
                <Link href={r.href} className="hover:underline">{r.label}</Link>
              ) : (
                r.label
              )}
            </span>
            <span className="flex h-3.5 min-w-0 flex-1 overflow-hidden rounded-sm" title={r.title ?? `${r.label} · ${money(total)}`}>
              {r.segments.map((v, i) =>
                v === 0 ? null : (
                  <span key={i} style={{ width: `${(v / m) * 100}%`, background: ramp(i, nSeg) }} />
                ),
              )}
            </span>
            <span className="num w-16 shrink-0 text-right" style={{ color: "var(--muted)" }}>
              {moneyCompact(total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- area trend (cash) ---------- */

export function AreaTrend({
  points,
  height = 200,
  width = 640,
}: {
  points: { label: string; value: number }[];
  height?: number;
  /** viewBox width — pass ~1280 when the chart spans the full page width so
   * text doesn't scale up with the container. */
  width?: number;
}) {
  const W = width;
  const H = height;
  const padL = 66;
  const padB = 18;
  const padT = 8;
  if (points.length === 0) return <p className="text-sm" style={{ color: "var(--muted)" }}>No bank activity yet.</p>;
  const vals = points.map((p) => p.value);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const x = (i: number) => padL + (points.length === 1 ? (W - padL) / 2 : (i / (points.length - 1)) * (W - padL - 8));
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (H - padT - padB);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const ticks = niceTicks(min, max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--muted)" className="num">
            {moneyCompact(t)}
          </text>
        </g>
      ))}
      <polygon
        points={`${x(0)},${y(Math.max(min, 0))} ${line} ${x(points.length - 1)},${y(Math.max(min, 0))}`}
        fill="color-mix(in srgb, var(--accent) 12%, transparent)"
      />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {points.map((p, i) =>
        p.label ? (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--muted)">
            {p.label}
          </text>
        ) : null,
      )}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="transparent">
          <title>{`${p.label} · ${money(p.value)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
