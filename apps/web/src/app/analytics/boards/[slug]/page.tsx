import type { Metadata } from "next";
import Link from "next/link";
import { monthEndDate, monthLabel, parsePeriodLens, type ResolvedLens } from "@af/shared";
import { getJson } from "@/lib/api";
import { money, moneyCompact } from "@/lib/format";
import { Breadcrumbs } from "@/components/Chrome";
import { PageHeader } from "@/components/ui";
import { AreaTrend, ChartCard, HBars, TrendChart, Waterfall } from "@/components/charts";
import PeriodPicker from "@/components/PeriodPicker";

export const metadata: Metadata = { title: "Board" };

/** Chat-built analytics board (plans/DATASET_V2.md PR-E): renders the stored
 * tile definitions through the SAME governed view endpoints and chart
 * primitives as /analytics — grounded, book-filtered and following the chart
 * house rules (UI_CONVENTIONS §4.8) by construction. Honours the period lens
 * unless a tile pins its own window. */

type Tile = { view: string; params?: Record<string, string>; title?: string; span?: number };
type BoardRow = { board: { slug: string; title: string; description: string | null; tiles: Tile[]; createdBy: string } };

const contribution = (m: number) => -m;
const th = "py-1.5 text-left text-[10px] uppercase tracking-wide";
const thR = "py-1.5 text-right text-[10px] uppercase tracking-wide";
const numTd = "py-1 text-right tabular-nums";

const qs = (params: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  return u.size ? `?${u}` : "";
};

async function renderTile(tile: Tile, i: number, L: ResolvedLens | null) {
  const p = tile.params ?? {};
  const win = L ? { from: p.from ?? L.from, to: p.to ?? L.to } : { from: p.from, to: p.to };
  const simpleTable = (rows: [string, number][], head: [string, string]) => (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
          <th className={th}>{head[0]}</th>
          <th className={thR}>{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, v], ri) => (
          <tr key={ri} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
            <td className="py-1">{label}</td>
            <td className={numTd}>{money(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (tile.view === "pl-trend") {
    const d = await getJson<{ months: string[]; rows: { code: string; name: string; type: string; period_code: string; amount_minor: number }[] }>(
      `/analytics/pl-trend${qs(win)}`,
    );
    if (!d) return null;
    const byAccount = new Map<string, { code: string; name: string; total: number; values: Map<string, number> }>();
    for (const r of d.rows) {
      const e = byAccount.get(r.code) ?? { code: r.code, name: r.name, total: 0, values: new Map() };
      const display = r.type === "income" ? -r.amount_minor : r.amount_minor;
      e.total += Math.abs(display);
      e.values.set(r.period_code, display);
      byAccount.set(r.code, e);
    }
    const top = [...byAccount.values()].sort((a, b) => b.total - a.total).slice(0, 6).sort((a, b) => a.code.localeCompare(b.code));
    return (
      <ChartCard
        key={i}
        title={tile.title ?? "P&L trend"}
        question="Monthly movement for the largest P&L lines (shown as positive amounts)."
        table={simpleTable(top.map((a) => [`${a.code} ${a.name}`, [...a.values.values()].reduce((x, y) => x + y, 0)]), ["Account", "Window total"])}
      >
        <TrendChart
          months={d.months}
          series={top.map((a) => ({ label: `${a.code} ${a.name}`, href: `/ledger/${a.code}`, values: d.months.map((m) => a.values.get(m) ?? null) }))}
        />
      </ChartCard>
    );
  }

  if (tile.view === "flux") {
    const windowed = !!(win.from && win.to && win.from !== win.to);
    const d = await getJson<{
      period: string; prior: string; partial: boolean;
      rows: { code: string; name: string; thisMinor: number; prevMinor: number; deltaMinor: number }[];
    }>(`/analytics/flux${qs(windowed ? win : { period: p.period ?? win.to })}`);
    if (!d) return null;
    const items = d.rows.map((r) => ({ ...r, contrib: contribution(r.deltaMinor) })).filter((r) => r.contrib !== 0);
    const keep = new Set([...items].sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib)).slice(0, 10).map((r) => r.code));
    const shown = items.filter((r) => keep.has(r.code));
    const other = items.filter((r) => !keep.has(r.code)).reduce((n, r) => n + r.contrib, 0);
    const prior = d.rows.reduce((n, r) => n + contribution(r.prevMinor), 0);
    const now = d.rows.reduce((n, r) => n + contribution(r.thisMinor), 0);
    return (
      <ChartCard
        key={i}
        title={tile.title ?? `Flux — ${monthLabel(d.period)} vs ${monthLabel(d.prior)}`}
        question="Why did the result move? Teal helped, amber hurt; grey anchors are the period results."
        table={simpleTable(items.map((r) => [`${r.code} ${r.name}`, r.contrib]), ["Account", "Contribution"])}
      >
        <Waterfall
          startLabel={windowed ? "Prior" : monthLabel(d.prior).slice(0, 3)}
          start={prior}
          items={[
            ...shown.map((r) => ({ label: r.name, delta: r.contrib, href: `/ledger/${r.code}${windowed ? qs(win) : `?period=${d.period}`}` })),
            ...(other !== 0 ? [{ label: `Other (${items.length - shown.length})`, delta: other }] : []),
          ]}
          endLabel={windowed && L ? L.label : monthLabel(d.period).slice(0, 3)}
          end={now}
        />
      </ChartCard>
    );
  }

  if (tile.view === "aging") {
    const side = p.side === "ar" ? "ar" : "ap";
    const today = new Date().toISOString().slice(0, 10);
    const asOf = p.asOf ?? (L ? (monthEndDate(L.to) < today ? monthEndDate(L.to) : today) : undefined);
    const d = await getJson<{
      asOf: string; buckets: readonly string[]; totalMinor: number; overdueMinor: number;
      parties: { code: string; name: string; buckets: number[]; totalMinor: number; items: number }[];
    }>(`/analytics/aging${qs({ side, asOf })}`);
    if (!d) return null;
    return (
      <ChartCard
        key={i}
        title={tile.title ?? (side === "ap" ? "AP aging" : "AR aging")}
        question={`Open items at ${d.asOf}: ${money(d.totalMinor)} total, ${money(d.overdueMinor)} past due.`}
        table={simpleTable(d.parties.map((x) => [x.name, x.totalMinor]), [side === "ap" ? "Supplier" : "Customer", "Open"])}
      >
        <HBars
          segmentLabels={[...d.buckets]}
          rows={d.parties.slice(0, 12).map((x) => ({
            label: x.name,
            segments: x.buckets,
            href: side === "ap" ? "/p2p/invoices" : "/o2c",
            title: `${x.name} · ${x.items} open · ${money(x.totalMinor)}`,
          }))}
        />
      </ChartCard>
    );
  }

  if (tile.view === "counterparty") {
    const dim = p.dim === "customer" ? "customer" : "supplier";
    const d = await getJson<{ parties: { code: string; name: string; totalMinor: number; invoices: number }[] }>(
      `/analytics/counterparty${qs({ dim, ...win })}`,
    );
    if (!d) return null;
    return (
      <ChartCard
        key={i}
        title={tile.title ?? (dim === "supplier" ? "Spend by supplier" : "Revenue by customer")}
        question={`Where ${dim === "supplier" ? "invoiced spend" : "billed revenue"} concentrates (gross, by invoice month).`}
        table={simpleTable(d.parties.map((x) => [x.name, x.totalMinor]), ["Name", "Total gross"])}
      >
        <HBars
          rows={d.parties.slice(0, 12).map((x) => ({
            label: x.name,
            segments: [x.totalMinor],
            href: dim === "supplier" ? "/p2p/invoices" : "/o2c",
            title: `${x.name} · ${x.invoices} invoices · ${money(x.totalMinor)}`,
          }))}
        />
      </ChartCard>
    );
  }

  if (tile.view === "cash") {
    const d = await getJson<{ points: { date: string; balanceMinor: number }[] }>(`/analytics/cash${qs(win)}`);
    if (!d || d.points.length === 0) return null;
    const pts = d.points.map((x) => ({
      label: new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short" }),
      value: x.balanceMinor,
    }));
    for (let j = pts.length - 1; j > 0; j--) if (pts[j]!.label === pts[j - 1]!.label) pts[j]!.label = "";
    const monthEnds = d.points.filter((x, j, a) => j === a.length - 1 || a[j + 1]!.date.slice(0, 7) !== x.date.slice(0, 7));
    return (
      <ChartCard
        key={i}
        title={tile.title ?? "Cash position"}
        question={`Cumulative bank balance by statement date — currently ${moneyCompact(d.points.at(-1)!.balanceMinor)}.`}
        table={simpleTable(monthEnds.map((x) => [x.date, x.balanceMinor]), ["Month end", "Balance"])}
      >
        <AreaTrend points={pts} width={(tile.span ?? 1) === 2 ? 1320 : 640} />
      </ChartCard>
    );
  }
  return null;
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lens?: string }>;
}) {
  const { slug } = await params;
  const { lens } = await searchParams;
  const L = parsePeriodLens(lens);
  const [row, flux] = await Promise.all([
    getJson<BoardRow>(`/analytics/boards/${slug}`),
    getJson<{ periods: string[] }>("/analytics/flux"),
  ]);
  if (!row) return <main>Board not found.</main>;
  const b = row.board;
  const tiles = await Promise.all(b.tiles.map((t, i) => renderTile(t, i, L)));

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/analytics", label: "Analytics" }, { label: b.title }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={b.title}
          context={`${b.description ?? "Chat-built board"} — composed in the Analyst chat, confirmed by a human; every tile is a governed view following the chart house rules.`}
        />
        <PeriodPicker periods={flux?.periods ?? []} lens={lens} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {tiles.map((t, i) => (
          <div key={i} className={(b.tiles[i]?.span ?? 1) === 2 ? "xl:col-span-2" : undefined}>
            {t ?? (
              <p className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
                Tile {i + 1} ({b.tiles[i]?.view}) returned no data.
              </p>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
