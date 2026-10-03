/**
 * Learned extraction templates (D15). The Invoice Extraction Agent's model
 * reads a supplier's first invoices; once PROMOTE_AFTER extractions complete
 * cleanly, the supplier is promoted and later invoices extract
 * deterministically — no model call. A miss (the deterministic parse can't
 * handle the document or the gateway rejects the capture) falls back to the
 * model and is counted; SUSPEND_AFTER misses demote the template back to
 * learning. Counters live in agent.extraction_template (agent knowledge —
 * survives demo data resets), priced at read time by the API's rate card.
 */
import { eq, sql } from "drizzle-orm";
import { extractionTemplate } from "@af/db";
import { db } from "../lib/db.js";

export const PROMOTE_AFTER = 3;
export const SUSPEND_AFTER = 2;

export async function getActiveTemplate(supplierCode: string): Promise<boolean> {
  if (!db) return false;
  const t = await db.query.extractionTemplate.findFirst({
    where: (r, { eq: e }) => e(r.supplierCode, supplierCode),
  });
  return t?.status === "active";
}

/** A validated model extraction for this supplier: count it toward promotion
 * and keep a rolling average of what a model run costs (for honest savings). */
export async function recordLearning(supplierCode: string, runTokens: number): Promise<void> {
  if (!db) return;
  await db
    .insert(extractionTemplate)
    .values({ supplierCode, confirmations: 1, avgModelTokens: runTokens })
    .onConflictDoUpdate({
      target: extractionTemplate.supplierCode,
      set: {
        confirmations: sql`${extractionTemplate.confirmations} + 1`,
        avgModelTokens: sql`((${extractionTemplate.avgModelTokens} * ${extractionTemplate.confirmations}) + ${runTokens}) / (${extractionTemplate.confirmations} + 1)`,
        lastUsedAt: new Date(),
      },
    });
  await db.execute(sql`
    update agent.extraction_template
    set status = 'active', promoted_at = now(), misses = 0
    where supplier_code = ${supplierCode} and status <> 'active' and confirmations >= ${PROMOTE_AFTER}`);
}

export async function recordHit(supplierCode: string): Promise<void> {
  if (!db) return;
  await db
    .update(extractionTemplate)
    .set({ hits: sql`${extractionTemplate.hits} + 1`, lastUsedAt: new Date() })
    .where(eq(extractionTemplate.supplierCode, supplierCode));
}

export async function recordMiss(supplierCode: string): Promise<void> {
  if (!db) return;
  await db
    .update(extractionTemplate)
    .set({ misses: sql`${extractionTemplate.misses} + 1`, lastUsedAt: new Date() })
    .where(eq(extractionTemplate.supplierCode, supplierCode));
  // repeated misses: the supplier's layout changed — back to the model to re-learn
  await db.execute(sql`
    update agent.extraction_template
    set status = 'learning', confirmations = 0
    where supplier_code = ${supplierCode} and status = 'active' and misses >= ${SUSPEND_AFTER}`);
}
