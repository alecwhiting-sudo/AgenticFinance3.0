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
  // KPI values are proportional sans, not tabular (UI_CONVENTIONS §4.1):
  // tabular digits look loose at display sizes.
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && (
        <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </div>
      )}
    </Card>
  );
}

/** The only stat tile (UI_CONVENTIONS §4.4): label · value · optional delta
 * (coloured by MEANING via goodWhen, never by sign) · optional hint. Pass
 * href when the number aggregates something — every number is a door. */
export function Kpi({
  label,
  value,
  delta,
  goodWhen = "up",
  hint,
  href,
  compact = false,
}: {
  label: string;
  value: string | number;
  delta?: number | null;
  goodWhen?: "up" | "down";
  hint?: string;
  href?: string;
  compact?: boolean;
}) {
  const deltaColor =
    delta == null || delta === 0
      ? "var(--muted)"
      : (delta > 0) === (goodWhen === "up")
        ? "var(--good)"
        : "var(--bad)";
  const body = (
    <div
      className={`rounded-xl border ${compact ? "p-3" : "p-4"} text-center transition-colors ${href ? "hover:border-[var(--accent)]" : ""}`}
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className={`${compact ? "text-lg" : "text-2xl"} font-semibold tracking-tight`}>{value}</div>
      <div className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{label}</div>
      {delta != null && (
        <div className="mt-0.5 text-xs font-medium" style={{ color: deltaColor }}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {Math.abs(delta)}
        </div>
      )}
      {hint && <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>{hint}</div>}
    </div>
  );
  return href ? <a href={href}>{body}</a> : body;
}

/** The only button (UI_CONVENTIONS §4.5). Variants: primary (at most one per
 * view region) · outline (secondary) · ghost (tertiary) · danger. */
export function Button({
  children,
  onClick,
  variant = "outline",
  disabled = false,
  title,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" },
    outline: { borderColor: "var(--accent)", color: "var(--accent)" },
    ghost: { borderColor: "var(--border)" },
    danger: { borderColor: "var(--bad)", color: "var(--bad)" },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
      style={styles[variant]}
    >
      {children}
    </button>
  );
}

/** Page header (UI_CONVENTIONS §4.2): title voice + context sentence +
 * actions top-right. The only way a page starts. */
export function PageHeader({
  title,
  context,
  actions,
}: {
  title: React.ReactNode;
  context?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {context && (
          <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>{context}</p>
        )}
      </div>
      {actions && <span className="flex flex-wrap items-center gap-2">{actions}</span>}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  const colors: Record<string, string> = {
    neutral: "var(--muted)",
    good: "var(--good)",
    warn: "var(--warn)",
    bad: "var(--bad)",
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
