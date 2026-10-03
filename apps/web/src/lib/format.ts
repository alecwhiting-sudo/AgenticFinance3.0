/** Shared formatters (UI_CONVENTIONS §1.3): one voice for money and time. */

/** GBP from integer pence. Negatives in accounting parentheses; zero is £0.00. */
export function money(minor: number): string {
  const abs = (Math.abs(minor) / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return minor < 0 ? `(£${abs})` : `£${abs}`;
}

/** Compact money for KPI values and aggregates (UI_CONVENTIONS §4.3):
 * £1,284 → £12.9k → £4.2m. One decimal at k/m; full pence stays in tables. */
export function moneyCompact(minor: number): string {
  const abs = Math.abs(minor) / 100;
  const sign = minor < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${sign}£${(abs / 1_000).toFixed(1)}k`;
  return `${sign}£${abs.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

/** Compact counts: 1,284 → 12.9k. */
export function numCompact(n: number): string {
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-GB");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3m ago" / "2h ago" / falls back to the date beyond a week. */
export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}
