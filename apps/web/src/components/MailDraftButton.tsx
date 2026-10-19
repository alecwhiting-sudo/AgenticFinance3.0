"use client";

/** Materialise a case option's display-only draft as an editable outbox
 * message and jump to the right mail room to release it (plans/P2P.md §11). */
import { useState } from "react";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";

export default function MailDraftButton({
  caseId,
  optionIndex,
  dest,
}: {
  caseId: string;
  optionIndex: number;
  dest: "/p2p/mail" | "/o2c/mail";
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await fetch(`${apiUrl}/p2p/mail/from-option`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ caseId, optionIndex, createdBy: "alec" }),
          });
          const d = (await r.json()) as { mail?: { id: string } };
          if (r.ok && d.mail) window.location.href = `${dest}?open=${d.mail.id}`;
        } catch {
          /* stay on page */
        }
        setBusy(false);
      }}
      className="mt-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
      style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
    >
      {busy ? "…" : "Edit & send in the mail room →"}
    </button>
  );
}
