"use client";

/** A single board pack (plans/DATASET_V2.md PR-G): the reviewable product.
 * While the agent is drafting it shows an honest WIP banner (safe to leave —
 * the row is server-side and this page is its permanent address); once
 * drafted it renders the sections with a print stylesheet, so "Print / save
 * as PDF" produces the takeaway document. */
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { Breadcrumbs } from "@/components/Chrome";
import { Button } from "@/components/ui";

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

export default function BoardPackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [pack, setPack] = useState<Pack | null | "missing">(null);

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

  if (pack === "missing") return <main>Board pack not found — see <Link href="/reports/board" className="underline">Board packs</Link>.</main>;
  if (pack === null) return <main className="text-sm" style={{ color: "var(--muted)" }}>Loading…</main>;

  return (
    <main className="max-w-3xl space-y-6">
      {/* print: only the pack itself */}
      <style>{`@media print { aside, header, .no-print { display: none !important; } main { max-width: 100% !important; } }`}</style>

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
          This draft failed — the run's transcript is in the{" "}
          <Link href="/work" className="underline">work queue</Link>. Draft the period again from{" "}
          <Link href="/reports/board" className="underline">Board packs</Link>.
        </section>
      )}

      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{pack.title}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {pack.periodFrom === pack.periodTo ? pack.periodFrom : `${pack.periodFrom} – ${pack.periodTo}`} · drafted by the
            Board Reporting Agent · actuals from the governed views · for human review
          </p>
        </div>
        {pack.status === "draft" && (
          <div className="no-print">
            <Button onClick={() => window.print()} variant="outline">Print / save as PDF</Button>
          </div>
        )}
      </section>

      {pack.sections.map((s) => (
        <section key={s.id} className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{s.heading}</h3>
          {s.figures && s.figures.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {s.figures.map((f) => (
                <div key={f.label} className="rounded-lg border p-2 text-center" style={{ borderColor: "var(--border)" }}>
                  <div className="text-sm font-semibold tracking-tight">{f.value}</div>
                  <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>{f.label}</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{s.body}</p>
        </section>
      ))}

      {pack.sections.length > 0 && (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          sources: {pack.sources.join("; ")} — every figure traces to a governed view.
        </p>
      )}

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
