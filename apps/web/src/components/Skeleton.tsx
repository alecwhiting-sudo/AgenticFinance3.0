/** Loading skeletons — shaped placeholders so navigation feels instant. */

export function SkeletonBar({ w = "100%", h = 14 }: { w?: string | number; h?: number }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{ width: w, height: h, background: "var(--border)" }}
    />
  );
}

export function PageSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <main className="space-y-6">
      <SkeletonBar w={240} h={28} />
      <SkeletonBar w={360} h={14} />
      <div
        className="space-y-3 rounded-xl border p-4"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBar key={i} h={14} w={`${100 - (i % 3) * 8}%`} />
        ))}
      </div>
    </main>
  );
}
