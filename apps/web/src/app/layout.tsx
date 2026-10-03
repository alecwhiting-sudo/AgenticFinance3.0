import type { Metadata } from "next";
// Typography system (UI_CONVENTIONS §4.1): Inter for UI, IBM Plex Mono for
// data — self-hosted via fontsource (no build-time font downloads).
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import Shell from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AgenticFinance", template: "%s · AgenticFinance" },
  description: "Agentic finance workbench",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* apply the saved theme before paint (Admin toggle; system default) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}`,
          }}
        />
      </head>
      <body className="antialiased">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
