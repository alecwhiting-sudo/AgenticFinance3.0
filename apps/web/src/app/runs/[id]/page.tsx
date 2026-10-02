import RunViewer from "./RunViewer";
import { Breadcrumbs } from "@/components/Chrome";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="space-y-4">
      <Breadcrumbs trail={[{ href: "/queue", label: "Queue" }, { label: `Run ${id.slice(0, 8)}` }]} />
      <RunViewer runId={id} />
    </main>
  );
}
