import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Chrome";
import DripButton from "@/components/DripButton";
import FlowView from "@/components/FlowView";

export const metadata: Metadata = { title: "Live flow" };

export default function FlowPage() {
  return (
    <main className="space-y-5">
      <Breadcrumbs trail={[{ href: "/p2p", label: "P2P" }, { label: "Live flow" }]} />
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">P2P live flow</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            The last 60 invoices moving through the pipeline. Drip one and watch
            it travel — exceptions branch to the agent lane below.
          </p>
        </div>
        <DripButton />
      </section>
      <FlowView />
    </main>
  );
}
