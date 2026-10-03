"use client";

/** The living diagram (docs/architecture.html), embedded in-app. Served by
 * the API from the repo's docs/ so it updates with every deploy. The iframe
 * is a different origin, so it can't read this app's theme from storage —
 * the current theme is passed as a query parameter instead, and re-applied
 * if the Admin toggle changes it while the page is open. */
import { useEffect, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/api";
import { Breadcrumbs } from "@/components/Chrome";

export default function ArchitecturePage() {
  const [theme, setTheme] = useState<string>("");

  useEffect(() => {
    const read = () => {
      try {
        const forced = document.documentElement.dataset.theme;
        if (forced === "dark" || forced === "light") return forced;
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      } catch {
        return "light";
      }
    };
    setTheme(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(read());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <main className="space-y-4">
      <Breadcrumbs trail={[{ href: "/admin", label: "Admin" }, { label: "Architecture" }]} />
      {theme && (
        <iframe
          src={`${PUBLIC_API_URL}/docs/architecture.html?theme=${theme}`}
          title="AgenticFinance architecture"
          className="w-full rounded-xl border"
          style={{ borderColor: "var(--border)", height: "calc(100vh - 10rem)", background: "var(--card)" }}
        />
      )}
    </main>
  );
}
