"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function DecidePurchase({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    await fetch(`${apiUrl}/p2p/purchases/${purchaseId}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve, decidedBy: "alec" }),
    });
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <button
        disabled={busy}
        onClick={() => decide(true)}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        style={{ background: "var(--accent)" }}
      >
        Approve
      </button>
      <button
        disabled={busy}
        onClick={() => decide(false)}
        className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
        style={{ borderColor: "var(--border)" }}
      >
        Reject
      </button>
    </div>
  );
}
