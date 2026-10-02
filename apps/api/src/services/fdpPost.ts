/** The Finance Data Platform posting pipeline (ARCHITECTURE.md D13).
 *
 * One pipe for all economic change: a business event enters with
 * account-coded deltas attached (finance-initiated modules — P2P, O2C) or
 * without them (business-initiated flows; an engine derives the deltas —
 * future). The pipeline validates, then atomically writes:
 *   event (processed) + movement rows (one per account) + balanced journal.
 * The database enforces the rest: idempotency (unique source key), movement
 * immutability, journal-line immutability, and a deferred constraint that
 * every journal sums to zero at commit.
 *
 * This module is the ONLY caller of postJournal for module postings — the
 * single point of economic mutation. */
import { eq } from "drizzle-orm";
import { fdpEvent, fdpMovement, type Db } from "@af/db";
import { postJournal, type JournalLineInput } from "./posting.js";

/** Engine identity stamped on every movement for replay traceability.
 * Deterministic code — no model call, ever (CLAUDE.md model routing). */
export const FDP_ENGINE_VERSION = "fdp-ts-1.0.0";

export type FdpEventInput = {
  eventType: string; // e.g. "ap.invoice.posted"
  occurredAt: string; // YYYY-MM-DD (journal date) — stored as UTC midnight
  sourceSystem: string; // loader | api | worker | drip
  sourceEventKey: string; // idempotency key within sourceSystem
  objectType: string; // ap_invoice | ap_payment | …
  objectId: string;
  details?: Record<string, unknown>;
  /** Account-coded deltas (minor units, debit positive). Attached by
   * finance-initiated modules; must balance to zero. Pass null for
   * business-initiated events: the derivation engine computes the deltas
   * from eventType + details (D13's second posture). */
  deltas: { accountCode: string; amountMinor: number; memo?: string }[] | null;
  memo: string;
  postedBy: string;
  /** Journal (source_type, source_id) override. Defaults to the economic
   * object — right for one-journal-per-object flows (invoice, payment).
   * Flows posting several journals against one object (e.g. period.tick)
   * must pass a per-event source to satisfy journal_source_unique. */
  journalSource?: { type: string; id: string };
};

export type FdpPostResult = { eventId: string; journalId: string; replayed: boolean };

/** Pure validation, unit-testable: balanced, non-empty, no zero deltas. */
export function validateDeltas(deltas: NonNullable<FdpEventInput["deltas"]>): string | null {
  if (deltas.length < 2) return "an economic event needs at least two deltas";
  if (deltas.some((d) => d.amountMinor === 0)) return "zero-amount delta";
  if (deltas.some((d) => !/^\d{4}$/.test(d.accountCode))) return "invalid account code";
  const sum = deltas.reduce((n, d) => n + d.amountMinor, 0);
  if (sum !== 0) return `deltas do not balance (sum ${sum})`;
  return null;
}

/** Post a business event through the platform. Idempotent: replaying the
 * same (sourceSystem, sourceEventKey) returns the original outcome and
 * writes nothing. */
export async function postEvent(db: Db, input: FdpEventInput): Promise<FdpPostResult> {
  // Second posture: no deltas attached → the engine derives them.
  const deltas =
    input.deltas ?? (await import("./fdpEngine.js")).deriveDeltas(input.eventType, input.details ?? {});
  const invalid = validateDeltas(deltas);
  if (invalid) throw new Error(`fdp event rejected: ${invalid}`);

  // Idempotent replay: the unique key is the contract (D13).
  const existing = await db.query.fdpEvent.findFirst({
    where: (t, { and, eq: e }) =>
      and(e(t.sourceSystem, input.sourceSystem), e(t.sourceEventKey, input.sourceEventKey)),
  });
  if (existing) {
    const mv = await db.query.fdpMovement.findFirst({ where: (t) => eq(t.eventId, existing.id) });
    if (existing.status === "processed" && mv)
      return { eventId: existing.id, journalId: mv.journalId, replayed: true };
    if (existing.status === "failed") {
      // Retry model (plans/R2R.md, OpenFinance PRD §41.7): the event row
      // stays; reprocessing after the cause is fixed cannot duplicate
      // accounting because the journal/movement write is atomic.
      const journalId = await applyEvent(db, existing.id, input, deltas);
      return { eventId: existing.id, journalId, replayed: false };
    }
    throw new Error(`fdp event ${existing.id} exists in status ${existing.status} — resolve before replay`);
  }

  const [ev] = await db
    .insert(fdpEvent)
    .values({
      eventType: input.eventType,
      occurredAt: new Date(`${input.occurredAt}T00:00:00Z`),
      sourceSystem: input.sourceSystem,
      sourceEventKey: input.sourceEventKey,
      objectType: input.objectType,
      objectId: input.objectId,
      details: input.details ?? {},
      deltas, // derived deltas are stored for traceability
      status: "pending",
    })
    .returning();

  const journalId = await applyEvent(db, ev!.id, input, deltas);
  return { eventId: ev!.id, journalId, replayed: false };
}

/** Atomic application: journal + movements + event status in one tx.
 * postJournal validates period-open and keeps journal numbering; the
 * deferred DB constraint re-proves the balance at commit. On failure the
 * event row stays (append-only) and is marked failed for the exception
 * lane; a later postEvent with the same source key retries it. */
async function applyEvent(
  db: Db,
  eventId: string,
  input: FdpEventInput,
  deltas: NonNullable<FdpEventInput["deltas"]>,
): Promise<string> {
  try {
    return await db.transaction(async (tx) => {
      const lines: JournalLineInput[] = deltas.map((d) => ({
        accountCode: d.accountCode,
        amountMinor: d.amountMinor,
        memo: d.memo,
      }));
      const j = await postJournal(tx as unknown as Db, {
        journalDate: input.occurredAt,
        memo: input.memo,
        sourceType: input.journalSource?.type ?? input.objectType,
        sourceId: input.journalSource?.id ?? input.objectId,
        postedBy: input.postedBy,
        lines,
      });
      await tx.insert(fdpMovement).values(
        deltas.map((d) => ({
          eventId,
          objectType: input.objectType,
          objectId: input.objectId,
          accountCode: d.accountCode,
          amountMinor: d.amountMinor,
          memo: d.memo,
          journalId: j.id,
          engineVersion: FDP_ENGINE_VERSION,
        })),
      );
      await tx
        .update(fdpEvent)
        .set({ status: "processed", error: null })
        .where(eq(fdpEvent.id, eventId));
      return j.id;
    });
  } catch (err) {
    await db.update(fdpEvent).set({ status: "failed", error: String(err) }).where(eq(fdpEvent.id, eventId));
    throw err;
  }
}
