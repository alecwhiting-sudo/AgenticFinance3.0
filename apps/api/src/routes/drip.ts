/** Demo drip (plans/P2P.md M3): synthesize a fresh invoice scenario and queue
 * it for the Invoice Extraction Agent, exactly as inbound mail would be. The
 * document arrives as its text layer (the AF-DATA block the Studio embeds in
 * every rendered PDF), so extraction is real work, keyless or live. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { agent, goodsReceipt, workItem } from "@af/db";
import { requireDb } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";
import { createPurchase } from "../services/purchaseIntake.js";

const SCENARIOS = ["clean", "price_variance", "qty_short_receipt", "missing_receipt", "no_purchase", "bank_detail_change", "scan_document"] as const;
type Scenario = (typeof SCENARIOS)[number];

const seedDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/db/seed",
);

const ITEMS = [
  { description: "Cloud hosting — monthly", accountCode: "6200", unit: 18000 },
  { description: "Campaign management — monthly", accountCode: "6400", unit: 95000 },
  { description: "Stationery order", accountCode: "6900", unit: 6500 },
  { description: "Associate subcontract — days", accountCode: "5000", unit: 68000 },
];

export function dripRoutes(app: FastifyInstance): void {
  app.post<{ Body: { scenario?: string } }>("/p2p/drip", async (req, reply) => {
    const db = requireDb();
    const scenario = (req.body?.scenario ?? "clean") as Scenario;
    if (!SCENARIOS.includes(scenario))
      return reply.code(400).send({ error: `scenario must be one of ${SCENARIOS.join(", ")}` });

    // Scan drip: a pre-rendered image-only PDF (no text layer, no purchase
    // reference) — the vision extraction path, Haiku-tier. The manifest's
    // structured truth rides along ONLY as the keyless fallback.
    if (scenario === "scan_document") {
      const manifest = JSON.parse(
        readFileSync(path.join(seedDir, "documents/drip-scan/manifest.json"), "utf8"),
      ) as {
        supplierCode: string; number: string; invoiceDate: string; dueDate: string;
        lines: { description: string; qty: number; unitPriceMinor: number; account: string }[];
        netMinor: number; vatMinor: number; grossMinor: number; file: string;
      }[];
      const used = new Set(
        (await db.query.apInvoice.findMany({ columns: { supplierInvoiceNumber: true } })).map(
          (i) => i.supplierInvoiceNumber,
        ),
      );
      const entry = manifest.find((m) => !used.has(m.number));
      if (!entry)
        return reply.code(409).send({ error: "all reserved scan invoices already captured — reload the dataset" });
      const scanSup = await db.query.supplier.findFirst({ where: (t) => eq(t.code, entry.supplierCode) });
      if (!scanSup) return reply.code(409).send({ error: `supplier ${entry.supplierCode} not loaded` });
      const extractionAgent = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "invoice-extraction") });
      if (!extractionAgent) return reply.code(409).send({ error: "invoice-extraction agent not seeded" });
      const [wi] = await db
        .insert(workItem)
        .values({
          type: "invoice.capture",
          agentId: extractionAgent.id,
          payload: {
            documentPath: entry.file,
            format: "scan_pdf",
            supplierCode: entry.supplierCode,
            emailText: `Please find attached our invoice ${entry.number} (scanned copy). Regards, ${scanSup.name}`,
            fallbackData: {
              number: entry.number,
              invoiceDate: entry.invoiceDate,
              dueDate: entry.dueDate,
              lines: entry.lines,
              netMinor: entry.netMinor,
              vatMinor: entry.vatMinor,
              grossMinor: entry.grossMinor,
            },
          },
          priority: 4,
        })
        .returning();
      await emitActivity({
        actorType: "human",
        actorId: "demo-drip",
        verb: "dripped_invoice",
        objectType: "work_item",
        objectId: wi!.id,
        summary: `Scanned invoice from ${scanSup.name} landed — no text layer, extraction must read the pixels`,
      });
      return { workItemId: wi!.id, scenario, supplier: scanSup.name, invoiceNumber: entry.number };
    }

    const suppliers = await db.query.supplier.findMany({ limit: 40 });
    const sup = suppliers[Math.floor(Math.random() * suppliers.length)]!;
    const item = ITEMS[Math.floor(Math.random() * ITEMS.length)]!;
    const qty = 1 + Math.floor(Math.random() * 5);
    const today = new Date().toISOString().slice(0, 10);

    // the approved purchase (unless the scenario is "no purchase record")
    let purchaseNumber: string | undefined;
    if (scenario !== "no_purchase") {
      const p = await createPurchase(db, {
        supplierCode: sup.code,
        requestedBy: "demo-drip",
        businessNeed: `Drip scenario: ${item.description}`,
        lines: [{ description: item.description, qty, unitPriceMinor: item.unit, accountCode: item.accountCode }],
      });
      purchaseNumber = p.number;
      if (p.status === "requested") {
        // keep the demo moving: approve mid-band drips as the demo user
        await db.execute(sql`
          update erp.purchase set status='approved', approved_by='demo-drip (pre-approved)',
            approved_at=now(), order_date=${today} where id=${p.id}`);
      }
      if (scenario !== "missing_receipt") {
        const received = scenario === "qty_short_receipt" ? Math.max(1, Math.floor(qty * 0.6)) : qty;
        await db.insert(goodsReceipt).values({
          number: `GRN-D${Date.now() % 1000000}`,
          purchaseId: p.id,
          receiptDate: today,
          quantities: [{ lineNo: 1, qtyReceived: received }],
          recordedBy: "ops",
        });
      }
    }

    const invoicedUnit = scenario === "price_variance" ? Math.round(item.unit * 1.12) : item.unit;
    const netMinor = qty * invoicedUnit;
    const vatMinor = Math.round(netMinor * 0.2);
    const invNumber = `${sup.name.replace(/[^A-Z]/g, "").slice(0, 3) || "INV"}-D${Date.now() % 100000}`;

    const documentText = `AF-DATA ${JSON.stringify({
      kind: "ap_invoice",
      supplier: sup.name,
      number: invNumber,
      invoiceDate: today,
      dueDate: today,
      po: purchaseNumber ?? null,
      netMinor,
      vatMinor,
      grossMinor: netMinor + vatMinor,
      lines: [{ description: item.description, qty, unitPriceMinor: invoicedUnit, account: item.accountCode }],
    })}`;
    const emailText =
      scenario === "bank_detail_change"
        ? `Please find attached our invoice ${invNumber}. IMPORTANT: our banking details have changed with immediate effect — remit to sort code 09-01-28, account 31926819. Kindly confirm before processing.`
        : `Please find attached our invoice ${invNumber}. Thanks as always.\n${sup.name}`;

    const extraction = await db.query.agent.findFirst({ where: (t) => eq(t.slug, "invoice-extraction") });
    if (!extraction) return reply.code(409).send({ error: "invoice-extraction agent not seeded" });
    const [wi] = await db
      .insert(workItem)
      .values({
        type: "invoice.capture",
        agentId: extraction.id,
        payload: { documentText, emailText, supplierCode: sup.code },
        priority: 4,
      })
      .returning();

    await emitActivity({
      actorType: "human",
      actorId: "demo-drip",
      verb: "dripped_invoice",
      objectType: "work_item",
      objectId: wi!.id,
      summary: `Fresh ${scenario} invoice from ${sup.name} landed in the capture queue`,
    });
    return { workItemId: wi!.id, scenario, supplier: sup.name, invoiceNumber: invNumber, purchaseNumber };
  });
}
