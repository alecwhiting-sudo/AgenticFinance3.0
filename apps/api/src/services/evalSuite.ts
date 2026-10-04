/** Eval suite runner (plans/RELEASE_GOVERNANCE.md M2a). Two kinds of case:
 *  - manufactured: `input` is the literal task payload (the original kind);
 *  - live-data:    `input.live` names a SELECTOR resolved against the real
 *    books at run time — the agent is graded on an actual record, asserting
 *    invariants rather than fixed answers. Commands still execute into the
 *    test book (D16), so live-data evals cannot touch the main books.
 * A live case with no matching record is recorded as skipped (passed, with
 * a note) so the suite still completes — absence of data is not a failure. */
import { desc, eq } from "drizzle-orm";
import { evalRun, workItem, type Db, type agent as agentTable, type agentRelease } from "@af/db";

type LiveResolution = { input: Record<string, unknown>; note: string } | null;

/** The selector registry — grows as live coverage grows. Each returns the
 * same payload shape the real intake produces for that task type. */
const LIVE_SELECTORS: Record<string, (db: Db) => Promise<LiveResolution>> = {
  /** The oldest open AP exception, exactly as /p2p/exceptions/:id/investigate
   * would queue it. */
  oldest_open_exception: async (db) => {
    const inv = await db.query.apInvoice.findFirst({
      where: (t, { and, eq: e, ne }) => and(e(t.status, "exception"), ne(t.book, "test")),
      orderBy: (t) => t.invoiceDate,
    });
    if (!inv) return null;
    const note = inv.caseId
      ? await db.query.caseEvent.findFirst({ where: (t) => eq(t.caseId, inv.caseId!) })
      : null;
    const detail = String((note?.detail as { detail?: string } | null)?.detail ?? inv.exceptionCode);
    return {
      input: {
        invoiceId: inv.id,
        caseId: inv.caseId,
        exceptionCode: inv.exceptionCode,
        detail,
        objective:
          "Investigate using get_invoice_context, then (1) propose case.options with 2-3 grounded, costed resolution options and (2) propose ap.invoice.resolve for your single recommended option. Never resolve bank_detail_change.",
      },
      note: `live record: ${inv.supplierInvoiceNumber} (${inv.exceptionCode})`,
    };
  },
  /** The most overdue posted AR invoice, as /o2c/chase would queue it. */
  most_overdue_ar_invoice: async (db) => {
    const inv = await db.query.arInvoice.findFirst({
      where: (t, { eq: e }) => e(t.status, "posted"),
      orderBy: (t) => t.dueDate,
    });
    if (!inv) return null;
    const cust = await db.query.customer.findFirst({ where: (t) => eq(t.id, inv.customerId) });
    const daysOverdue = Math.max(
      0,
      Math.floor((Date.now() - new Date(`${inv.dueDate}T00:00:00Z`).getTime()) / 86_400_000),
    );
    if (daysOverdue === 0) return null; // nothing overdue — nothing to chase
    return {
      input: {
        invoiceId: inv.id,
        number: inv.number,
        customerName: cust?.name ?? "the customer",
        grossMinor: inv.grossMinor,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        daysOverdue,
        paymentTermsDays: cust?.paymentTermsDays ?? 30,
      },
      note: `live record: ${inv.number} (${daysOverdue} days overdue)`,
    };
  },
};

export type StartedSuite = {
  evalRun: typeof evalRun.$inferSelect;
  queued: number;
  skipped: { name: string; reason: string }[];
};

/** Start an agent's eval suite — against its active release, or a specific
 * one (the stale-refresh evaluates DRAFTS this way). */
export async function startEvalSuite(
  db: Db,
  a: typeof agentTable.$inferSelect,
  release: typeof agentRelease.$inferSelect,
): Promise<StartedSuite | { error: string }> {
  const cases = await db.query.evalCase.findMany({ where: (t) => eq(t.agentId, a.id) });
  if (cases.length === 0) return { error: "agent has no eval cases" };

  const resolved: { evalCaseId: string; input: Record<string, unknown> }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const preResults: Record<string, unknown>[] = [];
  for (const c of cases) {
    const live = (c.input as { live?: string }).live;
    if (!live) {
      resolved.push({ evalCaseId: c.id, input: c.input });
      continue;
    }
    const selector = LIVE_SELECTORS[live];
    if (!selector) {
      skipped.push({ name: c.name, reason: `unknown live selector "${live}"` });
      preResults.push({ evalCaseId: c.id, runId: null, name: c.name, passed: false, failures: [`unknown live selector "${live}"`] });
      continue;
    }
    const r = await selector(db);
    if (!r) {
      skipped.push({ name: c.name, reason: "no matching live record — skipped" });
      preResults.push({ evalCaseId: c.id, runId: null, name: c.name, passed: true, failures: [], skipped: true });
      continue;
    }
    resolved.push({ evalCaseId: c.id, input: r.input });
  }

  const allDone = resolved.length === 0;
  const [er] = await db
    .insert(evalRun)
    .values({
      agentId: a.id,
      releaseId: release.id,
      results: preResults,
      passed: preResults.filter((r) => r.passed).length,
      failed: preResults.filter((r) => !r.passed).length,
      ...(allDone
        ? { status: (preResults.every((r) => r.passed) ? "passed" : "failed") as "passed" | "failed", finishedAt: new Date() }
        : {}),
    })
    .returning();

  if (!allDone) {
    await db.insert(workItem).values(
      resolved.map((c) => ({
        type: "eval.case",
        agentId: a.id,
        payload: { evalRunId: er!.id, evalCaseId: c.evalCaseId, input: c.input, releaseId: release.id },
        priority: 3,
      })),
    );
  }
  return { evalRun: er!, queued: resolved.length, skipped };
}

export async function activeRelease(db: Db, agentId: string) {
  return db.query.agentRelease.findFirst({
    where: (t, { and, eq: e }) => and(e(t.agentId, agentId), e(t.status, "active")),
    orderBy: (t) => desc(t.version),
  });
}
