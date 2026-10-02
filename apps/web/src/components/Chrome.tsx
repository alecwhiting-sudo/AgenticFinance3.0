/** Shared chrome pieces: breadcrumbs, api-down banner, timestamps. */
import Link from "next/link";
import { formatDateTime, relativeTime } from "@/lib/format";

export function Breadcrumbs({ trail }: { trail: { href?: string; label: string }[] }) {
  return (
    <nav className="mb-3 text-xs" style={{ color: "var(--muted)" }} aria-label="Breadcrumb">
      {trail.map((t, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5">/</span>}
          {t.href ? (
            <Link href={t.href} className="hover:underline">
              {t.label}
            </Link>
          ) : (
            <span style={{ color: "var(--foreground)" }}>{t.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** UI_CONVENTIONS §1.3: blank-not-zero. Show when a server fetch returned null. */
export function ApiDownBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="rounded-xl border p-4 text-sm"
      style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
    >
      The web server cannot reach the API — figures on this page are blank, not
      zero. Check the api service health and the web service&apos;s API_URL.
    </div>
  );
}

/** Relative time with the absolute on hover (UI_CONVENTIONS §1.7.4). */
export function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className="tabular-nums">
      {relativeTime(iso)}
    </time>
  );
}
