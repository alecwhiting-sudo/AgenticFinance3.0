/** Tiny shared presentational pieces — keep the workbench visually consistent. */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${className}`}
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const colors: Record<string, string> = {
    neutral: "var(--muted)",
    good: "var(--accent)",
    warn: "#d97706",
    bad: "#dc2626",
  };
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: "var(--border)", color: colors[tone] ?? colors.neutral }}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{children}</h3>;
}

export const toneForStatus = (s: string): string =>
  ({
    completed: "good",
    active: "good",
    passed: "good",
    executed: "good",
    open: "good",
    running: "warn",
    claimed: "warn",
    pending: "neutral",
    proposed: "warn",
    waiting_approval: "warn",
    escalated: "warn",
    draft: "neutral",
    evaluated: "neutral",
    abstained: "neutral",
    retired: "neutral",
    failed: "bad",
    rejected: "bad",
  })[s] ?? "neutral";
