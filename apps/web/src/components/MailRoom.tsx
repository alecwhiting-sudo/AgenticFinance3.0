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
import { useDialog } from "@/components/Dialog";
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
  process?: "p2p" | "o2c";
  attachments: { label: string; path: string }[];
  invoiceDocPath?: string | null;
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
  { key: "outbox", label: "Drafts" },
  { key: "sent", label: "Sent" },
  { key: "inbox", label: "Inbox" },
] as const;

export default function MailRoom({ process }: { process: "p2p" | "o2c" }) {
  const params = useSearchParams();
  const openId = params.get("open");
  const [box, setBox] = useState<string>(openId ? "outbox" : params.get("box") ?? "outbox");
  const [messages, setMessages] = useState<Mail[] | null>(null);
  const [documents, setDocuments] = useState<InboxDoc[]>([]);
  const [openMail, setOpenMail] = useState<string | null>(openId);
  const [edit, setEdit] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [attach, setAttach] = useState<{ label: string; path: string }[]>([]);
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [reader, setReader] = useState<{
    from: string; to: string; date: string; subject: string; attachment: string | null;
    body: string; invoiceId: string; invoiceNumber: string; emailPath: string; documentPath: string | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiDown, setApiDown] = useState(false);

  const load = useCallback(async (b: string) => {
    try {
      const r = await fetch(`${apiUrl}/p2p/mail?box=${b}&process=${process}`);
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { messages: Mail[]; documents: InboxDoc[] };
      setMessages(d.messages);
      setDocuments(d.documents ?? []);
      setApiDown(false);
    } catch {
      setApiDown(true);
    }
  }, [process]);
  useEffect(() => {
    void load(box);
  }, [box, load]);

  const current = messages?.find((m) => m.id === openMail) ?? null;
  useEffect(() => {
    if (current && current.status === "draft" && !edit) {
      setEdit({ to: current.toAddr, subject: current.subject, body: current.body });
      setAttach(current.attachments ?? []);
    }
  }, [current, edit]);

  const save = async () => {
    if (!current || !edit) return;
    setBusy(true);
    try {
      await fetch(`${apiUrl}/p2p/mail/${current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...edit, attachments: attach, editedBy: "alec" }),
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
    const ok = await dialog.confirm({
      title: `Release this email to ${edit.to}?`,
      body: `${attach.length ? `Going with it: ${attach.map((a) => a.label).join(", ")}.\n\n` : ""}This is the human approval for external comms — the send is recorded on the case and the activity feed. (Demo transport: simulated, nothing leaves the sandbox.)`,
      confirmLabel: "Release — send",
    });
    if (!ok) return;
    setBusy(true);
    try {
      // save any edits first so what is sent is exactly what is on screen
      await fetch(`${apiUrl}/p2p/mail/${current.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...edit, attachments: attach, editedBy: "alec" }),
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
    const ok = await dialog.confirm({
      title: "Discard this draft?",
      body: "It will not be sent and leaves no trace on the case.",
      confirmLabel: "Discard",
      tone: "danger",
    });
    if (!ok) return;
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
      <Breadcrumbs
        trail={
          process === "o2c"
            ? [{ href: "/o2c", label: "Order to Cash" }, { label: "O2C Mail" }]
            : [{ href: "/p2p", label: "Procure to Pay" }, { label: "P2P Mail" }]
        }
      />
      <ApiDownBanner show={apiDown} />
      <section>
        <h2 className="text-2xl font-semibold tracking-tight">{process === "o2c" ? "O2C Mail" : "P2P Mail"}</h2>
        <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--muted)" }}>
          The correspondence your resolutions trigger, handled without leaving the workbench. Agents
          only ever <em>draft</em> — picking a resolution option puts its letter here; you edit it and
          release it. Every send is recorded on the case and the audit trail. This room shows {process === "o2c" ? "customer (O2C)" : "supplier (P2P)"} correspondence;
          the other process has its own mail room.
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
              setReader(null);
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
              <Badge tone={current.process === "o2c" ? "warn" : "neutral"}>{current.process === "o2c" ? "O2C — customer letter" : "P2P — supplier letter"}</Badge>{" "}
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
          <div className="mt-3 text-xs">
            <span className="font-medium" style={{ color: "var(--muted)" }}>Attachments: </span>
            {attach.map((a, i) => (
              <span key={i} className="mr-2 inline-flex items-center gap-1 rounded-lg border px-2 py-0.5" style={{ borderColor: "var(--border)" }}>
                <a href={`${apiUrl}/${a.path}`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
                  {a.label}
                </a>
                <button onClick={() => setAttach(attach.filter((_, j) => j !== i))} title="Remove attachment" style={{ color: "var(--muted)" }}>
                  ×
                </button>
              </span>
            ))}
            {attach.length === 0 && <span style={{ color: "var(--muted)" }}>none — </span>}
            {current.invoiceDocPath && !attach.some((a) => a.path === current.invoiceDocPath) && (
              <button
                onClick={() =>
                  setAttach([
                    ...attach,
                    {
                      label: `Invoice ${current.invoiceNumber ?? ""} (${current.invoiceDocPath!.endsWith(".xml") ? "e-invoice XML" : "PDF"})`.replace("  ", " "),
                      path: current.invoiceDocPath!,
                    },
                  ])
                }
                className="hover:underline"
                style={{ color: "var(--accent)" }}
              >
                + attach invoice document
              </button>
            )}
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
          {(current.attachments ?? []).length > 0 && (
            <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
              Attachments:{" "}
              {current.attachments.map((a, i) => (
                <a key={i} href={`${apiUrl}/${a.path}`} target="_blank" rel="noreferrer" className="mr-2 hover:underline" style={{ color: "var(--accent)" }}>
                  {a.label} ↗
                </a>
              ))}
            </p>
          )}
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
                    setAttach(m.attachments ?? []);
                  }}
                  className="flex w-full items-baseline justify-between gap-3 px-4 py-3 text-left hover:opacity-80"
                >
                  <span className="min-w-0">
                    <Badge tone={m.process === "o2c" ? "warn" : "neutral"}>{m.process === "o2c" ? "O2C" : "P2P"}</Badge>{" "}
                    <span className="text-sm font-medium">{m.subject}</span>
                    <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                      to {m.toAddr}
                      {m.invoiceNumber ? ` · ${m.invoiceNumber}` : ""}
                      {m.counterparty ? ` · ${m.counterparty}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                    {(m.attachments ?? []).length > 0 && <span title={m.attachments.map((a) => a.label).join(", ")}>📎{m.attachments.length} </span>}
                    <Badge tone={m.status === "sent" ? "good" : "warn"}>{m.status}</Badge>{" "}
                    {formatDate(m.sentAt ?? m.createdAt)}
                  </span>
                </button>
              </li>
            ))}
            {messages !== null && messages.length === 0 && (
              <li className="px-4 py-4 text-sm" style={{ color: "var(--muted)" }}>
                {box === "outbox"
                  ? process === "o2c"
                    ? "No drafts waiting. Pick an option with a draft reply on a dispute or receipt query (O2C page) and it lands here."
                    : "No drafts waiting. Pick a resolution option with a draft letter on the Exceptions page and it lands here."
                  : "Nothing sent yet."}
              </li>
            )}
          </ul>
        </section>
      )}

      {/* inbox reading pane — the email, readable without downloading */}
      {box === "inbox" && reader && (
        <section className="rounded-xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--card)" }}>
          <div className="flex items-baseline justify-between gap-2">
            <SectionTitle>{reader.subject}</SectionTitle>
            <button onClick={() => setReader(null)} className="text-xs hover:underline" style={{ color: "var(--muted)" }}>
              close
            </button>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            From {reader.from} · To {reader.to} · {reader.date}
          </p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6">{reader.body}</pre>
          <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
            {reader.attachment && <>Attachment: {reader.attachment} · </>}
            <Link href={`/p2p/invoices/${reader.invoiceId}`} className="hover:underline" style={{ color: "var(--accent)" }}>
              open invoice {reader.invoiceNumber}
            </Link>
            {reader.documentPath && (
              <>
                {" "}·{" "}
                <a href={`${apiUrl}/${reader.documentPath}`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
                  invoice PDF ↗
                </a>
              </>
            )}
            {" "}·{" "}
            <a href={`${apiUrl}/${reader.emailPath}`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--accent)" }}>
              original .eml ↗
            </a>
          </p>
        </section>
      )}

      {/* inbox: front door */}
      {box === "inbox" && (
        <section className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div className="px-4 pt-3 text-xs" style={{ color: "var(--muted)" }}>
            {process === "o2c" ? "The front door: customer queries and disputes, tied to their invoices." : "The front door: supplier emails that brought invoices in, tied to their documents."}
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {(messages ?? [])
              .filter((m) => m.direction === "in")
              .map((m) => (
                <li key={m.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{m.subject}</span>
                    <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                      from {m.fromAddr} · {formatDate(m.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5" style={{ color: "var(--muted)" }}>&ldquo;{m.body}&rdquo;</p>
                  {m.counterparty && <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>{m.counterparty}{m.invoiceNumber ? ` · ${m.invoiceNumber}` : ""}</p>}
                </li>
              ))}
            {documents.map((d) => (
              <li key={d.invoiceId} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <button
                    onClick={async () => {
                      try {
                        const r = await fetch(`${apiUrl}/p2p/mail/doc/${d.invoiceId}`);
                        if (r.ok) setReader(await r.json());
                      } catch {
                        /* leave reader closed */
                      }
                    }}
                    className="text-left text-sm font-medium hover:underline"
                    style={{ color: "var(--accent)" }}
                  >
                    {d.subject}
                  </button>
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
            {documents.length === 0 && (messages ?? []).length === 0 && (
              <li className="px-4 py-4 text-sm" style={{ color: "var(--muted)" }}>Nothing received.</li>
            )}
          </ul>
        </section>
      )}
    </main>
  );
}
