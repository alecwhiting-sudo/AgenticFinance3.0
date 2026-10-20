import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq, sql } from "drizzle-orm";
import { mailMessage } from "@af/db";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

/**
 * Mail room (plans/P2P.md §11): draft → edit → release, entirely inside the
 * workbench. The division of labour follows the finance safety rule:
 *  - AGENTS only ever attach display-only drafts to case options — they can
 *    never send, and nothing here changes that.
 *  - A HUMAN picks an option; its draft materialises as an editable outbox
 *    message. The human edits and clicks Send — that click IS the approval
 *    for external comms, recorded with who/when on the message, the case
 *    timeline and the activity feed.
 *  - Transport is simulated in the demo (status moves to "sent", nothing
 *    leaves the sandbox); a real SMTP/Graph connector slots in behind
 *    releaseMail() without touching anything above it.
 * The inbox is the front door: the dataset's supplier covering emails (tied
 * to their invoices) plus any inbound rows recorded later.
 */

/** Which process a message belongs to, from the case that produced it:
 * ar_* cases (disputes, receipt queries) are O2C, everything else P2P. */
async function tagProcess<T extends { caseId: string | null }>(
  db: ReturnType<typeof requireDb>,
  rows: T[],
): Promise<(T & { process: "p2p" | "o2c" })[]> {
  const ids = [...new Set(rows.map((r) => r.caseId).filter(Boolean))] as string[];
  const kinds = new Map<string, string>();
  if (ids.length) {
    const cases = await db.query.evidenceCase.findMany({ where: (t, { inArray }) => inArray(t.id, ids) });
    for (const c of cases) kinds.set(c.id, c.kind);
  }
  return rows.map((r) => ({
    ...r,
    process: (((r.caseId && (kinds.get(r.caseId) ?? "").startsWith("ar_")) ||
      (r as { source?: string }).source === "dispute"
        ? "o2c"
        : "p2p")) as "p2p" | "o2c",
  }));
}

export function mailRoutes(app: FastifyInstance): void {
  /** List a mailbox. Outbox = editable drafts; sent = released mail; inbox =
   * inbound rows + the dataset's covering emails (read-only documents). */
  app.get<{ Querystring: { box?: string; limit?: string; process?: "p2p" | "o2c" } }>("/p2p/mail", async (req) => {
    const db = requireDb();
    const box = req.query.box ?? "outbox";
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
    if (box === "inbox") {
      const inRows = await db.query.mailMessage.findMany({
        where: (t, { eq: e }) => e(t.direction, "in"),
        orderBy: (t) => desc(t.createdAt),
        limit,
      });
      // the dataset's supplier covering emails are the demo's inbound mail —
      // real documents already on the invoices, surfaced as the front door
      const docs = (
        await db.execute(sql`
          select i.id, i.supplier_invoice_number as number, i.invoice_date, i.gross_minor,
                 i.email_path, s.name as supplier, s.email as supplier_email
          from erp.ap_invoice i join erp.supplier s on s.id = i.supplier_id
          where i.email_path is not null and i.book <> 'test'
          order by i.invoice_date desc
          limit ${limit}
        `)
      ).rows as { id: string; number: string; invoice_date: string; gross_minor: string; email_path: string; supplier: string; supplier_email: string | null }[];
      const taggedIn = await tagProcess(db, inRows);
      const procIn = req.query.process;
      return {
        messages: procIn ? taggedIn.filter((m) => m.process === procIn) : taggedIn,
        // the covering-email front door is AP correspondence — P2P only
        documents: (procIn === "o2c" ? [] : docs).map((d) => ({
          invoiceId: d.id,
          invoiceNumber: d.number,
          receivedOn: d.invoice_date,
          grossMinor: Number(d.gross_minor),
          from: d.supplier_email ?? d.supplier,
          counterparty: d.supplier,
          subject: `Invoice ${d.number}`,
          emailPath: d.email_path,
        })),
      };
    }
    const rows = await db.query.mailMessage.findMany({
      where: (t, { and: a, eq: e }) =>
        a(e(t.direction, "out"), e(t.status, box === "sent" ? "sent" : "draft")),
      orderBy: (t) => (box === "sent" ? desc(t.sentAt) : desc(t.createdAt)),
      limit,
    });
    const tagged = await tagProcess(db, rows);
    const withDocs = await Promise.all(
      tagged.map(async (m) => {
        if (!m.invoiceId) return { ...m, invoiceDocPath: null as string | null };
        const inv = await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, m.invoiceId!) });
        return { ...m, invoiceDocPath: inv?.documentPath ?? null };
      }),
    );
    const proc = req.query.process;
    return { messages: proc ? withDocs.filter((m) => m.process === proc) : withDocs, documents: [] };
  });


  /** Read a supplier covering email IN the app: parses the stored .eml
   * (headers, body, attachment name) so the inbox never forces a download.
   * Addressed by invoiceId — the path on the invoice row is the only file
   * ever read, so nothing user-supplied touches the filesystem. */
  app.get<{ Params: { invoiceId: string } }>("/p2p/mail/doc/:invoiceId", async (req, reply) => {
    const db = requireDb();
    const inv = await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, req.params.invoiceId) });
    if (!inv?.emailPath) return reply.code(404).send({ error: "no covering email on this invoice" });
    const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/db/seed/documents");
    const rel = inv.emailPath.replace(/^documents\//, "");
    let raw: string;
    try {
      raw = await readFile(path.join(docsRoot, rel), "utf8");
    } catch {
      return reply.code(404).send({ error: "email file not found" });
    }
    const sep = raw.indexOf("\n\n");
    const headerText = sep === -1 ? raw : raw.slice(0, sep);
    const body = sep === -1 ? "" : raw.slice(sep + 2).trim();
    const headers: Record<string, string> = {};
    for (const line of headerText.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return {
      from: headers["from"] ?? "",
      to: headers["to"] ?? "",
      date: headers["date"] ?? "",
      subject: headers["subject"] ?? `Invoice ${inv.supplierInvoiceNumber}`,
      attachment: headers["x-attachment"] ?? null,
      body,
      invoiceId: inv.id,
      invoiceNumber: inv.supplierInvoiceNumber,
      emailPath: inv.emailPath,
      documentPath: inv.documentPath,
    };
  });

  /** Materialise a case option's display-only draft into an editable outbox
   * message — the "pick this option" moment. Idempotent per case + option
   * so double clicks never create two drafts. */
  app.post<{ Body: { caseId: string; optionIndex: number; createdBy?: string } }>(
    "/p2p/mail/from-option",
    async (req, reply) => {
      const db = requireDb();
      const { caseId, optionIndex } = req.body ?? ({} as never);
      const createdBy = String(req.body?.createdBy ?? "workbench");
      if (!caseId || typeof optionIndex !== "number")
        return reply.code(400).send({ error: "caseId and optionIndex required" });
      const events = await db.query.caseEvent.findMany({
        where: (t, { eq: e }) => e(t.caseId, caseId),
        orderBy: (t) => t.at,
      });
      const optionsEvent = [...events].reverse().find((e) => e.kind === "options");
      const options = ((optionsEvent?.detail as { options?: { label?: string; emailDraft?: { to: string; subject: string; body: string } }[] } | null)?.options ?? []);
      const opt = options[optionIndex];
      if (!opt) return reply.code(404).send({ error: "option not found on this case" });
      if (!opt.emailDraft) return reply.code(409).send({ error: "this option carries no email draft" });
      // the case's opening note links the document this mail is about
      const note = events.find((e) => e.kind === "note");
      const detail = (note?.detail ?? {}) as Record<string, unknown>;
      const invoiceId = typeof detail.invoiceId === "string" ? detail.invoiceId : null;
      let invoiceNumber: string | null = typeof detail.invoiceNumber === "string" ? detail.invoiceNumber : null;
      let counterparty: string | null = typeof detail.customerName === "string" ? detail.customerName : null;
      // the document under discussion travels WITH the letter by default —
      // the human can detach it in the editor before releasing
      const attachments: { label: string; path: string }[] = [];
      if (invoiceId) {
        const inv = await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, invoiceId) });
        if (inv) {
          invoiceNumber = invoiceNumber ?? inv.supplierInvoiceNumber;
          const s = await db.query.supplier.findFirst({ where: (t, { eq: e }) => e(t.id, inv.supplierId) });
          counterparty = counterparty ?? s?.name ?? null;
          if (inv.documentPath)
            attachments.push({
              label: `Invoice ${inv.supplierInvoiceNumber} (${inv.documentPath.endsWith(".xml") ? "e-invoice XML" : "PDF"})`,
              path: inv.documentPath,
            });
        }
      }
      const existing = await db.query.mailMessage.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.caseId, caseId), e(t.subject, opt.emailDraft!.subject), e(t.status, "draft")),
      });
      if (existing) return { mail: existing, existed: true };
      const [created] = await db
        .insert(mailMessage)
        .values({
          direction: "out",
          status: "draft",
          toAddr: opt.emailDraft.to,
          fromAddr: "accounts.payable@brightline.example",
          subject: opt.emailDraft.subject,
          body: opt.emailDraft.body,
          source: "option_pick",
          caseId,
          invoiceId,
          invoiceNumber,
          counterparty,
          optionLabel: opt.label ?? null,
          attachments,
          createdBy,
        })
        .returning();
      await db.insert((await import("@af/db")).caseEvent).values({
        caseId,
        actorType: "human",
        actorId: createdBy,
        kind: "note",
        detail: { note: `Email draft opened in the mail room from option "${opt.label ?? optionIndex}" — review and release from P2P → Mail room.`, mailId: created!.id },
      });
      return { mail: created, existed: false };
    },
  );

  /** Edit a draft — only drafts; sent mail is evidence and immutable. */
  app.patch<{
    Params: { id: string };
    Body: { to?: string; subject?: string; body?: string; editedBy?: string; attachments?: { label: string; path: string }[] };
  }>(
    "/p2p/mail/:id",
    async (req, reply) => {
      const db = requireDb();
      const row = await db.query.mailMessage.findFirst({ where: (t, { eq: e }) => e(t.id, req.params.id) });
      if (!row) return reply.code(404).send({ error: "message not found" });
      if (row.status !== "draft") return reply.code(409).send({ error: "only drafts can be edited — sent mail is evidence" });
      const [updated] = await db
        .update(mailMessage)
        .set({
          ...(req.body?.to ? { toAddr: req.body.to } : {}),
          ...(req.body?.subject ? { subject: req.body.subject } : {}),
          ...(req.body?.body ? { body: req.body.body } : {}),
          ...(Array.isArray(req.body?.attachments)
            ? {
                attachments: req.body.attachments
                  .filter((a) => typeof a?.label === "string" && typeof a?.path === "string" && a.path.startsWith("documents/"))
                  .map((a) => ({ label: a.label.slice(0, 120), path: a.path })),
              }
            : {}),
          editedBy: String(req.body?.editedBy ?? "workbench"),
        })
        .where(eq(mailMessage.id, req.params.id))
        .returning();
      return { mail: updated };
    },
  );

  /** Release (send) a draft. The click is the human approval for external
   * comms; the demo transport is simulated — the record, the case timeline
   * and the activity feed carry the evidence either way. */
  app.post<{ Params: { id: string }; Body: { sentBy?: string } }>(
    "/p2p/mail/:id/send",
    async (req, reply) => {
      const db = requireDb();
      const row = await db.query.mailMessage.findFirst({ where: (t, { eq: e }) => e(t.id, req.params.id) });
      if (!row) return reply.code(404).send({ error: "message not found" });
      if (row.status !== "draft") return reply.code(409).send({ error: `message is ${row.status}` });
      const sentBy = String(req.body?.sentBy ?? "workbench");
      const [sent] = await db
        .update(mailMessage)
        .set({ status: "sent", sentBy, sentAt: new Date() })
        .where(eq(mailMessage.id, req.params.id))
        .returning();
      if (row.caseId) {
        const { caseEvent } = await import("@af/db");
        await db.insert(caseEvent).values({
          caseId: row.caseId,
          actorType: "human",
          actorId: sentBy,
          kind: "note",
          detail: {
            note: `Email released to ${row.toAddr}: "${row.subject}"${row.attachments.length ? ` with ${row.attachments.length} attachment(s): ${row.attachments.map((a) => a.label).join(", ")}` : ""} (sent from the mail room — simulated transport)`,
            mailId: row.id,
          },
        });
      }
      await emitActivity({
        actorType: "human",
        actorId: sentBy,
        verb: "sent_mail",
        objectType: "mail",
        objectId: row.id,
        caseId: row.caseId ?? undefined,
        summary: `${sentBy} released "${row.subject}" to ${row.toAddr}${row.invoiceNumber ? ` (${row.invoiceNumber})` : ""}${row.attachments.length ? ` with ${row.attachments.length} attachment(s)` : ""}`,
      });
      return { mail: sent };
    },
  );

  /** Discard a draft that should never go — drafts only, recorded nowhere
   * else because an unsent draft is not evidence. */
  app.post<{ Params: { id: string } }>("/p2p/mail/:id/discard", async (req, reply) => {
    const db = requireDb();
    const row = await db.query.mailMessage.findFirst({ where: (t, { eq: e }) => e(t.id, req.params.id) });
    if (!row) return reply.code(404).send({ error: "message not found" });
    if (row.status !== "draft") return reply.code(409).send({ error: "only drafts can be discarded" });
    await db.update(mailMessage).set({ status: "archived" }).where(eq(mailMessage.id, req.params.id));
    return { ok: true };
  });
}
