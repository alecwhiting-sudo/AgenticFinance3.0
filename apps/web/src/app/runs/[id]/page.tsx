import RunViewer from "./RunViewer";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main>
      <RunViewer runId={id} />
    </main>
  );
}
