"use client";

/** Appearance switch (Admin): system / light / dark. Persists to
 * localStorage; a pre-paint script in layout.tsx applies it before render. */
import { useEffect, useState } from "react";

const MODES = ["system", "light", "dark"] as const;
type Mode = (typeof MODES)[number];

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setMode(t);
    } catch { /* storage unavailable: stay on system */ }
  }, []);

  const apply = (m: Mode) => {
    setMode(m);
    try {
      if (m === "system") {
        localStorage.removeItem("theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("theme", m);
        document.documentElement.dataset.theme = m;
      }
    } catch { /* storage unavailable */ }
  };

  return (
    <span className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--border)" }}>
      {MODES.map((m) => (
        <button
          key={m}
          onClick={() => apply(m)}
          className="px-3 py-1.5 text-sm capitalize"
          style={
            mode === m
              ? { background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", fontWeight: 500 }
              : { color: "var(--muted)" }
          }
        >
          {m}
        </button>
      ))}
    </span>
  );
}
