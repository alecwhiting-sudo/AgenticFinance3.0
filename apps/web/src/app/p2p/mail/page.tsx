"use client";

/** Mail room (plans/P2P.md §11): the P2P front door and outbox, so a
 * resolution's correspondence never needs a round trip to Outlook.
 *  - OUTBOX: drafts materialised when a human picks a case option (agents
 *    only ever draft — they cannot send). Edit in place, then Release: that
 *    click is the human approval for external comms, recorded on the
 *    message, the case timeline and the activity feed. Demo transport is
 *    simulated — nothing leaves the sandbox.
 *  - SENT: released mail, immutable evidence.
 *  - INBOX: supplier correspondence — the dataset's covering emails tied to
 *    their invoices, plus any recorded inbound messages. */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PUBLIC_API_URL as apiUrl } from "@/lib/api";
import { Badge, SectionTitle } from "@/components/ui";
import { ApiDownBanner, Breadcrumbs } from "@/components/Chrome";
import { formatDate, money } from "@/lib/format";

type Mail = {
  id: string;
  direction: string;
  status: string;
  toAddr: string;
  fromAddr: string;
  subject: string;
  body: string;
  source: string;
  caseId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  counterparty: string | null;
  optionLabel: string | null;
  createdBy: string;
  editedBy: string | null;
  sentBy: string | null;
  sentAt: string | null;
  createdAt: string;
};
type InboxDoc = {
  invoiceId: string;
  invoiceNumber: string;
  receivedOn: string;
  grossMinor: number;
  from: string;
  counterparty: string;
  subject: string;
  emailPath: string;
};

const BOXES = [
  { key: "outbox", label: "Outbox" },
  { key: "sent", label: "Sent" },
  { key: "inbox", label: "Inbox" },
] as const;

export default function MailRoomPage() {
  const params = useSearchParams();
  const openId = params.get("open");
  const [box, setBox] = useState<string>(openId ? "outbox" : params.get("box") ?? "outbox");
  const [messages, setMessages] = useState<Mail[] | null>(null);
  const [documents, setDocuments] = useState<InboxDoc[]>([]);
  const [openMail, setOpenMail] = useState<string | null>(openId);
  const [edit, setEdit] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);

  const load = useCallback(async (b: string) => {
    try {
      const r = await fetch(`${apiUrl}/p2p/mail?box=${b}`);
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { messages: Mail[]; documents: InboxDoc[] };
      setMessages(d.messages);
      setDocuments(d.documents ?? []);
      setApiDown(false);
    } catch {
      setApiDown(true);
    }
  }, []);
  useEffect(() => {
    void load(box);
  }, [box, load]);

  const current = messages?.find((m) => m.id === openMail) ?? null;
  useEffect(() => {
    if (current && current.status === "draft" && !edit)
      setEdit({ to: current.toAddr, subject: current.subject, body: current.body });
  }, [current, edit]);

  const save = async () => {
    if (!current || !edit) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/p2p/mail/${current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...edit, editedBy: "alec" }),
      });
      setNotice("Draft saved.");
      await load(box);
    } catch {
      setNotice("Could not save.");
    }
    setBusy(false);
  };

  const send = async () => {
    if (!current || !edit) return;
    if (!window.confirm(`Release this email to ${edit.to}?\n\nThis is the human approval for external comms — the send is recorded on the case and the activity feed. (Demo transport: simulated, nothing leaves the sandbox.)`)) return;
    setBusy(true);
    try {
      // save any edits first so what is sent is exactly what is on screen
      await fetch(`${apiUrl}/p2p/mail/${current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...edit, editedBy: "alec" }),
      });
      const r = await fetch(`${apiUrl}/p2p/mail/${current.id}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sentBy: "alec" }),
      });
      if (r.ok) {
        setNotice(`Released to ${edit.to}.`);
        setOpenMail(null);
        setEdit(null);
        setBox("sent");
      } else setNotice("Could not send.");
    } catch {
      setNotice("Could not send.");
    }
    setBusy(false);
  };

  const discard = async () => {
    if (!current) return;
    if (!window.confirm("Discard this draft? It will not be sent and leaves no trace on the case.")) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/p2p/mail/${current.id}/discard`, { method: "POST" });
      setOpenMail(null);
      setEdit(null);
      await load(box);
    } catch {
      /* keep draft */
    }
    setBusy(false);
  };

  return (
    <main className="space-y-6">
      <Breadcrumbs trail={[{ href: "/p2p", label: "Procure to Pay" }, { label: "Mail room" }]} />
      <ApiDownBanner show={apiDown} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Mail room</h2>
        <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
          The correspondence your resolutions trigger, handled without leaving the workbench. Agents
          only ever <em>draft</em> — picking a resolution option puts its letter here; you edit it and
          release it. Every send is recorded on the case and the audit trail.
        </p>
      </section>

      <div className="flex gap-2">
        {BOXES.map((b) => (
          <button
            key={b.key}
            onClick={() => {
              setBox(b.key);
              setOpenMail(null);
              setEdit(null);
            }}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium"
            style={
              box === b.key
                ? { borderColor: "var(--accent)", color: "var(--accent)" }
                : { borderColor: "var(--border)", color: "var(--muted)" }
            }
          >
            {b.label}
          </button>
        ))}
      </div>
      {notice && <p className="text-xs" style={{ color: "var(--muted)" }}>{notice}</p>}

      {/* draft editor */}
      {current && current.status === "draft" && edit && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="flex items-baseline justify-between">
            <SectionTitle>Edit &amp; release</SectionTitle>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              from option &ldquo;{current.optionLabel ?? "—"}&rdquo;
              {current.invoiceNumber ? ` · ${current.invoiceNumber}` : ""}
              {current.counterparty ? ` · ${current.counterparty}` : ""}
            </span>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
              To
              <input
                value={edit.to}
                onChange={(e) => setEdit({ ...edit, to: e.target.value })}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
            </label>
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
              Subject
              <input
                value={edit.subject}
                onChange={(e) => setEdit({ ...edit, subject: e.target.value })}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)" }}
              />
            </label>
            <label className="block text-xs font-medium" style={{ color: "var(--muted)" }}>
              Body
              <textarea
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                rows={12}
                className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2 font-sans text-sm leading-6"
                style={{ borderColor: "var(--border)" }}
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              disabled={busy}
              onClick={send}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              {busy ? "…" : "Release — send"}
            </button>
            <button
              disabled={busy}
              onClick={save}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
              style={{ borderColor: "var(--border)" }}
            >
              Save draft
            </button>
            <button
              disabled={busy}
              onClick={discard}
              className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Discard
            </button>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Releasing is your approval — recorded as sent by you (demo transport: simulated).
            </span>
          </div>
        </section>
      )}

      {/* sent reader */}
      {current && current.status === "sent" && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="flex items-baseline justify-between">
            <SectionTitle>{current.subject}</SectionTitle>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              sent by {current.sentBy} · {current.sentAt ? new Date(current.sentAt).toLocaleString() : ""}
            </span>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            To {current.toAddr}
            {current.invoiceNumber ? ` · ${current.invoiceNumber}` : ""} — sent mail is evidence and cannot be edited.
          </p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6">{current.body}</pre>
        </section>
      )}

      {/* message list */}
      {box !== "inbox" && (
        <section className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {(messages ?? []).map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => {
                    setOpenMail(m.id);
                    setEdit(m.status === "draft" ? { to: m.toAddr, subject: m.subject, body: m.body } : null);
                  }}
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left hover:opacity-80"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium">{m.subject}</span>
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                      to {m.toAddr}
                      {m.invoiceNumber ? ` · ${m.invoiceNumber}` : ""}
                      {m.counterparty ? ` · ${m.counterparty}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                    <Badge tone={m.status === "sent" ? "good" : "warn"}>{m.status}</Badge>{" "}
                    {formatDate(m.sentAt ?? m.createdAt)}
                  </span>
                </button>
              </li>
            ))}
            {messages !== null && messages.length === 0 && (
              <li className="px-4 py-4 text-sm" style={{ color: "var(--muted)" }}>
                {box === "outbox"
                  ? "No drafts waiting. Pick a resolution option with a draft letter on the Exceptions page and it lands here."
                  : "Nothing sent yet."}
              </li>
            )}
          </ul>
        </section>
      )}

      {/* inbox: front door */}
      {box === "inbox" && (
        <section className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="px-4 pt-3 text-xs" style={{ color: "var(--muted)" }}>
            The front door: supplier emails that brought invoices in, tied to their documents.
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {documents.map((d) => (
              <li key={d.invoiceId} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <a
                    href={`${apiUrl}/${d.emailPath}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {d.subject}
                  </a>
                  <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                    from {d.from} · {d.counterparty}
                  </span>
                </span>
                <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                  {money(d.grossMinor)} ·{" "}
                  <Link href={`/p2p/invoices/${d.invoiceId}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                    invoice
                  </Link>{" "}
                  · {formatDate(d.receivedOn)}
                </span>
              </li>
            ))}
            {documents.length === 0 && (
              <li className="px-4 py-4 text-sm" style={{ color: "var(--muted)" }}>Nothing received.</li>
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
