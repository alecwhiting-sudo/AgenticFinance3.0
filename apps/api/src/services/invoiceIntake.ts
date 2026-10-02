/** Invoice intake + exception resolution (plans/P2P.md M3).
 * captureInvoice is the single runtime entry: email fraud screen → duplicate
 * heuristics → 3-way match against the approved Purchase → straight-through
 * posting for clean matches (the "approve once" payoff) or an evidence case
 * plus a queued investigation for the Invoice Exception Agent. */
import { and, eq } from "drizzle-orm";
import {
  agent,
  apInvoice,
  caseEvent,
  evidenceCase,
  goodsReceipt,
  purchase,
  workItem,
  type Db,
  type PurchaseLine,
} from "@af/db";
import { isDuplicate, threeWayMatch } from "./match.js";
import { markPurchaseReceived, postApInvoice } from "./posting.js";
import { createPurchase } from "./purchaseIntake.js";
import { emitActivity } from "../lib/activity.js";

export const looksLikeBankDetailChange = (text: string): boolean =>
  /\b(sort\s*code|bank(ing)?\s+details?|account\s+number|remit.*to)\b/i.test(text) &&
  /\bchang|new account|immediate effect|updated bank/i.test(text);

export type CaptureInvoiceData = {
  supplierCode: string;
  supplierInvoiceNumber: string;
  purchaseNumber?: string;
  invoiceDate: string;
  dueDate: string;
  lines: { description: string; qty: number; unitPriceMinor: number; accountCode: string }[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  emailText?: string;
  documentPath?: string;
  emailPath?: string;
};

async function receivedFor(db: Db, purchaseId: string): Promise<Map<number, number> | null> {
  const receipts = await db.query.goodsReceipt.findMany({
    where: (t) => eq(t.purchaseId, purchaseId),
  });
  if (receipts.length === 0) return null;
  const m = new Map<number, number>();
  for (const r of receipts)
    for (const q of r.quantities) m.set(q.lineNo, (m.get(q.lineNo) ?? 0) + q.qtyReceived);
  return m;
}

async function openExceptionCase(
  db: Db,
  inv: typeof apInvoice.$inferSelect,
  supplierName: string,
  code: string,
  detail: string,
): Promise<void> {
  const [c] = await db
    .insert(evidenceCase)
    .values({
      kind: code === "bank_detail_change" ? "fraud-risk" : "invoice-exception",
      title: `${code}: ${supplierName} invoice ${inv.supplierInvoiceNumber}`,
    })
    .returning();
  await db.insert(caseEvent).values({
    caseId: c!.id,
    actorType: "system",
    actorId: "match-service",
    kind: "note",
    detail: { exceptionCode: code, detail, invoiceId: inv.id },
  });
  await db
    .update(apInvoice)
    .set({ status: "exception", exceptionCode: code, caseId: c!.id })
    .where(eq(apInvoice.id, inv.id));

  // queue the investigation for the Invoice Exception Agent
  const exceptionAgent = await db.query.agent.findFirst({
    where: (t) => eq(t.slug, "invoice-exception"),
  });
  if (exceptionAgent) {
    await db.insert(workItem).values({
      type: "invoice.exception",
      agentId: exceptionAgent.id,
      caseId: c!.id,
      payload: { invoiceId: inv.id, caseId: c!.id, exceptionCode: code, detail },
      priority: 3,
    });
  }
  await emitActivity({
    actorType: "system",
    actorId: "match-service",
    verb: "raised_exception",
    objectType: "case",
    objectId: c!.id,
    caseId: c!.id,
    summary: `${code} on ${supplierName} invoice ${inv.supplierInvoiceNumber} — case opened, investigation queued`,
  });
}

export async function captureInvoice(
  db: Db,
  data: CaptureInvoiceData,
): Promise<{ invoiceId: string; status: string; exceptionCode?: string }> {
  const sup = await db.query.supplier.findFirst({ where: (t) => eq(t.code, data.supplierCode) });
  if (!sup) throw Object.assign(new Error(`unknown supplier ${data.supplierCode}`), { statusCode: 400 });
  const p = data.purchaseNumber
    ? await db.query.purchase.findFirst({ where: (t) => eq(t.number, data.purchaseNumber!) })
    : null;

  const lines: PurchaseLine[] = data.lines.map((l, i) => ({ lineNo: i + 1, ...l }));
  const [inv] = await db
    .insert(apInvoice)
    .values({
      supplierId: sup.id,
      supplierInvoiceNumber: data.supplierInvoiceNumber,
      purchaseId: p?.id ?? null,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      lines,
      netMinor: data.netMinor,
      vatMinor: data.vatMinor,
      grossMinor: data.grossMinor,
      documentPath: data.documentPath,
      emailPath: data.emailPath,
    })
    .onConflictDoNothing({ target: [apInvoice.supplierId, apInvoice.supplierInvoiceNumber] })
    .returning();
  if (!inv)
    throw Object.assign(
      new Error(`invoice ${data.supplierInvoiceNumber} already captured for this supplier`),
      { statusCode: 409 },
    );

  await emitActivity({
    actorType: "system",
    actorId: "invoice-intake",
    verb: "captured_invoice",
    objectType: "ap_invoice",
    objectId: inv.id,
    summary: `Captured ${sup.name} invoice ${inv.supplierInvoiceNumber} (£${(inv.grossMinor / 100).toFixed(2)})`,
  });

  // 1. fraud screen on the covering email (untrusted text)
  if (data.emailText && looksLikeBankDetailChange(data.emailText)) {
    await openExceptionCase(db, inv, sup.name, "bank_detail_change", "Covering email asks to change bank details");
    return { invoiceId: inv.id, status: "exception", exceptionCode: "bank_detail_change" };
  }

  // 2. duplicate heuristics against this supplier's history
  const prior = await db.query.apInvoice.findMany({
    where: (t) => and(eq(t.supplierId, sup.id)),
  });
  const dup = isDuplicate(
    { supplierInvoiceNumber: inv.supplierInvoiceNumber, grossMinor: inv.grossMinor, invoiceDate: inv.invoiceDate },
    prior.filter((x) => x.id !== inv.id),
  );
  if (dup.duplicate) {
    await openExceptionCase(db, inv, sup.name, "duplicate_suspect", dup.reason!);
    return { invoiceId: inv.id, status: "exception", exceptionCode: "duplicate_suspect" };
  }

  // 3. 3-way match against the approved purchase
  const received = p ? await receivedFor(db, p.id) : null;
  const match = threeWayMatch({
    purchase: p ? { status: p.status, lines: p.lines } : null,
    received,
    invoiceLines: lines,
  });
  if (match.result === "exception") {
    await openExceptionCase(db, inv, sup.name, match.code, match.detail);
    return { invoiceId: inv.id, status: "exception", exceptionCode: match.code };
  }

  // clean: straight through — spend was approved at intent (D12)
  await db.update(apInvoice).set({ status: "matched" }).where(eq(apInvoice.id, inv.id));
  await postApInvoice(db, inv.id, "straight-through");
  await emitActivity({
    actorType: "system",
    actorId: "invoice-intake",
    verb: "posted_straight_through",
    objectType: "ap_invoice",
    objectId: inv.id,
    summary: `${sup.name} ${inv.supplierInvoiceNumber} matched ${p?.number ?? ""} and posted — zero touches since approval`,
  });
  return { invoiceId: inv.id, status: "posted" };
}

/* ----------------------- exception resolutions ----------------------- */

export type ResolveParams = {
  invoiceId: string;
  resolution: "approve_adjusted" | "part_approve" | "record_receipt" | "reject" | "retro_purchase";
  rationale: string;
  /** for part_approve: replacement quantities per lineNo */
  adjustedQuantities?: { lineNo: number; qty: number }[];
};

export async function resolveInvoiceException(
  db: Db,
  params: ResolveParams,
  decidedBy: string,
): Promise<Record<string, unknown>> {
  const inv = await db.query.apInvoice.findFirst({ where: (t) => eq(t.id, params.invoiceId) });
  if (!inv) throw Object.assign(new Error("invoice not found"), { statusCode: 404 });
  if (inv.status !== "exception")
    throw Object.assign(new Error(`invoice is ${inv.status}, not exception`), { statusCode: 409 });
  if (inv.exceptionCode === "bank_detail_change")
    throw Object.assign(
      new Error("bank_detail_change is human-only: verify out-of-band, then reject or re-capture"),
      { statusCode: 403 },
    );

  const close = async (note: string, status: "resolved" = "resolved") => {
    if (inv.caseId) {
      await db.insert(caseEvent).values({
        caseId: inv.caseId,
        actorType: "human",
        actorId: decidedBy,
        kind: "decision",
        detail: { resolution: params.resolution, rationale: params.rationale, note },
      });
      await db
        .update(evidenceCase)
        .set({ status, resolvedAt: new Date() })
        .where(eq(evidenceCase.id, inv.caseId));
    }
    await emitActivity({
      actorType: "human",
      actorId: decidedBy,
      verb: "resolved_exception",
      objectType: "ap_invoice",
      objectId: inv.id,
      caseId: inv.caseId ?? undefined,
      summary: `${inv.exceptionCode} on ${inv.supplierInvoiceNumber}: ${params.resolution} — ${note}`,
    });
  };

  switch (params.resolution) {
    case "reject": {
      await db.update(apInvoice).set({ status: "rejected" }).where(eq(apInvoice.id, inv.id));
      await close("invoice rejected");
      return { status: "rejected" };
    }
    case "approve_adjusted": {
      // accept the invoiced prices as the agreed ones; post as billed
      await db.update(apInvoice).set({ status: "approved", exceptionCode: null }).where(eq(apInvoice.id, inv.id));
      const j = await postApInvoice(db, inv.id, decidedBy);
      await close("posted at invoiced amounts");
      return { status: "posted", journalId: j.journalId };
    }
    case "part_approve": {
      if (!params.adjustedQuantities?.length)
        throw Object.assign(new Error("adjustedQuantities required for part_approve"), { statusCode: 400 });
      const byLine = new Map(params.adjustedQuantities.map((a) => [a.lineNo, a.qty]));
      const lines = inv.lines.map((l) => ({ ...l, qty: byLine.get(l.lineNo) ?? l.qty }));
      const netMinor = lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
      const vatMinor = Math.round(netMinor * 0.2);
      await db
        .update(apInvoice)
        .set({ lines, netMinor, vatMinor, grossMinor: netMinor + vatMinor, status: "approved", exceptionCode: null })
        .where(eq(apInvoice.id, inv.id));
      const j = await postApInvoice(db, inv.id, decidedBy);
      await close(`part-approved for received quantities (£${((netMinor + vatMinor) / 100).toFixed(2)})`);
      return { status: "posted", journalId: j.journalId, grossMinor: netMinor + vatMinor };
    }
    case "record_receipt": {
      if (!inv.purchaseId)
        throw Object.assign(new Error("no purchase to receipt against"), { statusCode: 409 });
      const p = (await db.query.purchase.findFirst({ where: (t) => eq(t.id, inv.purchaseId!) }))!;
      await db.insert(goodsReceipt).values({
        number: `GRN-R${Date.now() % 100000}`,
        purchaseId: p.id,
        receiptDate: new Date().toISOString().slice(0, 10),
        quantities: p.lines.map((l) => ({ lineNo: l.lineNo, qtyReceived: l.qty })),
        recordedBy: decidedBy,
      });
      await markPurchaseReceived(db, p.id);
      await db.update(apInvoice).set({ status: "approved", exceptionCode: null }).where(eq(apInvoice.id, inv.id));
      const j = await postApInvoice(db, inv.id, decidedBy);
      await close("receipt confirmed and recorded; invoice posted");
      return { status: "posted", journalId: j.journalId };
    }
    case "retro_purchase": {
      const sup = (await db.query.supplier.findFirst({ where: (t) => eq(t.id, inv.supplierId) }))!;
      const created = await createPurchase(db, {
        supplierCode: sup.code,
        requestedBy: decidedBy,
        businessNeed: `Retro purchase for invoice ${inv.supplierInvoiceNumber} (${params.rationale})`,
        lines: inv.lines.map((l) => ({
          description: l.description,
          qty: l.qty,
          unitPriceMinor: l.unitPriceMinor,
          accountCode: l.accountCode,
        })),
      });
      if (created.status === "requested")
        return {
          status: "awaiting_purchase_approval",
          purchaseNumber: created.number,
          note: "retro purchase exceeds auto band — approve it, then resolve again with record_receipt",
        };
      await db.insert(goodsReceipt).values({
        number: `GRN-R${Date.now() % 100000}`,
        purchaseId: created.id,
        receiptDate: new Date().toISOString().slice(0, 10),
        quantities: created.lines.map((l) => ({ lineNo: l.lineNo, qtyReceived: l.qty })),
        recordedBy: decidedBy,
      });
      await markPurchaseReceived(db, created.id);
      await db
        .update(apInvoice)
        .set({ purchaseId: created.id, status: "approved", exceptionCode: null })
        .where(eq(apInvoice.id, inv.id));
      const j = await postApInvoice(db, inv.id, decidedBy);
      await close(`retro purchase ${created.number} created under auto band; posted`);
      return { status: "posted", journalId: j.journalId, purchaseNumber: created.number };
    }
  }
}
