/** Purchase intake + approval router (plans/P2P.md §0, §3.1).
 * Creating a purchase is standing authority; the router auto-approves the
 * auto band under policy and queues standard/director for a human click. */
import { eq, sql } from "drizzle-orm";
import { purchase, supplier, type Db, type PurchaseLine } from "@af/db";
import { approvalBandFor, linesTotal } from "./policy.js";
import { commitPurchaseBudget } from "./posting.js";
import { emitActivity } from "../lib/activity.js";

export type CreatePurchaseParams = {
  supplierCode?: string;
  supplierName?: string;
  requestedBy: string;
  businessNeed: string;
  lines: { description: string; qty: number; unitPriceMinor: number; accountCode: string }[];
};

async function resolveSupplier(
  db: Db,
  params: CreatePurchaseParams,
): Promise<{ row: typeof supplier.$inferSelect; known: boolean }> {
  if (params.supplierCode) {
    const row = await db.query.supplier.findFirst({ where: (t) => eq(t.code, params.supplierCode!) });
    if (row) return { row, known: true };
  }
  if (params.supplierName) {
    const all = await db.query.supplier.findMany();
    const needle = params.supplierName.toLowerCase();
    const row = all.find((s) => s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()));
    if (row) return { row, known: true };
    // New supplier: create it, but the purchase goes to the director band.
    const co = await db.query.company.findFirst();
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from erp.supplier`)).rows as { n: number }[];
    const [created] = await db
      .insert(supplier)
      .values({
        companyId: co!.id,
        code: `SUP-${String(Number(n) + 1).padStart(3, "0")}`,
        name: params.supplierName,
        paymentTermsDays: 30,
      })
      .returning();
    await emitActivity({
      actorType: "system",
      actorId: "purchase-intake",
      verb: "created_supplier",
      objectType: "supplier",
      objectId: created!.code,
      summary: `New supplier ${params.supplierName} created — purchases route to director band`,
    });
    return { row: created!, known: false };
  }
  throw Object.assign(new Error("supplierCode or supplierName required"), { statusCode: 400 });
}

export async function createPurchase(
  db: Db,
  params: CreatePurchaseParams,
): Promise<typeof purchase.$inferSelect> {
  const { row: sup, known } = await resolveSupplier(db, params);
  const lines: PurchaseLine[] = params.lines.map((l, i) => ({ lineNo: i + 1, ...l }));
  const totalMinor = linesTotal(lines);
  const band = approvalBandFor(totalMinor, known);
  const today = new Date().toISOString().slice(0, 10);
  const [{ next }] = (
    await db.execute(
      sql`select coalesce(max((substring(number from 4))::int), 260999) + 1 as next
          from erp.purchase where number ~ '^PO-[0-9]+$'`,
    )
  ).rows as { next: number }[];
  const number = `PO-${next}`;

  const auto = band === "auto";
  const [created] = await db
    .insert(purchase)
    .values({
      number,
      supplierId: sup.id,
      requestedBy: params.requestedBy,
      businessNeed: params.businessNeed,
      requestDate: today,
      approvalBand: band,
      approvedBy: auto ? "standing-authority (auto band)" : null,
      approvedAt: auto ? new Date() : null,
      orderDate: auto ? today : null,
      lines,
      totalMinor,
      status: auto ? "approved" : "requested",
    })
    .returning();

  if (auto) await commitPurchaseBudget(db, { lines, orderDate: today });

  await emitActivity({
    actorType: "system",
    actorId: "approval-router",
    verb: auto ? "auto_approved_purchase" : "queued_purchase_approval",
    objectType: "purchase",
    objectId: created!.id,
    summary: auto
      ? `${number} (${sup.name}, £${(totalMinor / 100).toFixed(2)}) auto-approved under standing policy`
      : `${number} (${sup.name}, £${(totalMinor / 100).toFixed(2)}) awaits ${band} approval`,
  });
  return created!;
}

export async function decidePurchase(
  db: Db,
  purchaseId: string,
  approve: boolean,
  decidedBy: string,
): Promise<typeof purchase.$inferSelect> {
  const p = await db.query.purchase.findFirst({ where: (t) => eq(t.id, purchaseId) });
  if (!p) throw Object.assign(new Error("purchase not found"), { statusCode: 404 });
  if (p.status !== "requested")
    throw Object.assign(new Error(`purchase is ${p.status}, not requested`), { statusCode: 409 });

  const today = new Date().toISOString().slice(0, 10);
  const [updated] = await db
    .update(purchase)
    .set(
      approve
        ? { status: "approved", approvedBy: decidedBy, approvedAt: new Date(), orderDate: today }
        : { status: "rejected", approvedBy: decidedBy, approvedAt: new Date() },
    )
    .where(eq(purchase.id, p.id))
    .returning();
  if (approve) await commitPurchaseBudget(db, { lines: p.lines, orderDate: today });

  await emitActivity({
    actorType: "human",
    actorId: decidedBy,
    verb: approve ? "approved_purchase" : "rejected_purchase",
    objectType: "purchase",
    objectId: p.id,
    summary: `${decidedBy} ${approve ? "approved" : "rejected"} ${p.number} (£${(p.totalMinor / 100).toFixed(2)})`,
  });
  return updated!;
}
