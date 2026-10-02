import type { Metadata } from "next";
import { PUBLIC_API_URL } from "@/lib/api";
import { Breadcrumbs } from "@/components/Chrome";

export const metadata: Metadata = { title: "Architecture" };

/** The living diagram (docs/architecture.html), embedded in-app. Served by
 * the API from the repo's docs/ so it updates with every deploy. */
export default function ArchitecturePage() {
  return (
    <main className="space-y-4">
      <Breadcrumbs trail={[{ href: "/admin", label: "Admin" }, { label: "Architecture" }]} />
      <iframe
        src={`${PUBLIC_API_URL}/docs/architecture.html`}
        title="AgenticFinance architecture"
        className="w-full rounded-xl border"
        style={{ borderColor: "var(--border)", height: "calc(100vh - 10rem)", background: "var(--card)" }}
      />
    </main>
  );
}
