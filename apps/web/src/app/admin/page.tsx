import type { Metadata } from "next";
import Link from "next/link";
import FlushHistory from "@/components/FlushHistory";
import ThemeToggle from "@/components/ThemeToggle";
import { Card, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Admin</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Platform housekeeping. Demo scenarios and data controls live on the{" "}
          <Link href="/test" className="hover:underline" style={{ color: "var(--accent)" }}>
            Test panel
          </Link>
          .
        </p>
      </section>

      <Card>
        <SectionTitle>Architecture</SectionTitle>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          The living system diagram and schema map, maintained alongside the
          architecture doc — click any component for what it is and why it matters —{" "}
          <Link href="/admin/architecture" className="hover:underline" style={{ color: "var(--accent)" }}>
            view the diagram →
          </Link>
        </p>
      </Card>

      <Card>
        <SectionTitle>Appearance</SectionTitle>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Theme for this browser. System follows the OS setting.
        </p>
        <ThemeToggle />
      </Card>

      <Card>
        <SectionTitle>Maintenance</SectionTitle>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Keep the demo cheap (D14): strip old run transcripts, prune old eval runs — their
          summaries and the agents&apos; learned templates survive. Economic data is never touched.
        </p>
        <FlushHistory />
      </Card>
    </main>
  );
}
