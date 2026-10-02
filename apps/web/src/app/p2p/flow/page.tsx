import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Chrome";
import Link from "next/link";
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
            The last 60 invoices moving through the pipeline. Drip one from Admin and watch
            it travel — exceptions branch to the agent lane below.
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Drip from Admin →
        </Link>
      </section>
      <FlowView />
    </main>
  );
}
