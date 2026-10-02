import type { Metadata } from "next";
import DripButton from "@/components/DripButton";
import AdminData from "@/components/AdminData";
import { Card, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <main className="space-y-6">
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Admin</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          The demo control room — none of this exists for the finance users.
        </p>
      </section>

      <AdminData />

      <Card>
        <SectionTitle>Drip a transaction</SectionTitle>
        <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
          Lands a fresh invoice in the capture queue, exactly as inbound mail
          would — then watch it travel on the P2P live flow.
        </p>
        <DripButton />
      </Card>
    </main>
  );
}
