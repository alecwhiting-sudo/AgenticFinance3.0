export default function Loading() {
  return (
    <main className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded-lg" style={{ background: "var(--border)" }} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl" style={{ background: "var(--border)" }} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-72 animate-pulse rounded-xl" style={{ background: "var(--border)" }} />
        ))}
      </div>
    </main>
  );
}
