/** LRS — lock / certify / supersede (D13 step 3, plans/R2R.md M5).
 * Close is a PHYSICAL SNAPSHOT, never a recalculation: locking copies the
 * period's per-account movements and closing balances into fdp.lrs_snapshot;
 * certifying freezes it; restating reopens the period, marks the old
 * snapshot superseded (reason recorded) and the next lock writes the next
 * version. The posting pipe refuses journals into any non-open period, so
 * a certified month cannot drift — and the close card proves it by
 * reconciling the live books back to the certified snapshot. */
import { sql } from "drizzle-orm";
import { lrsSnapshot, lrsSnapshotLine, type Db } from "@af/db";
import { emitActivity } from "../lib/activity.js";

export type CloseGate = { id: string; label: string; level: "hard" | "warn"; ok: boolean; detail: string };

async function periodRow(db: Db, code: string) {
  const p = await db.query.fiscalPeriod.findFirst({ where: (t, { eq }) => eq(t.code, code) });
  if (!p) throw Object.assign(new Error(`no fiscal period ${code}`), { statusCode: 404 });
  return p;
}

export async function closeGates(db: Db, code: string): Promise<CloseGate[]> {
  const [g] = (
    await db.execute(sql`
      select
        coalesce((select sum(jl.amount_minor) from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test' and j.period_code = ${code}), 0)::bigint as balance,
        (select count(*)::int from fdp.event where status = 'failed' and book <> 'test') as failed_events,
        (select count(*)::int from erp.ap_invoice where book <> 'test' and status = 'exception'
          and to_char(invoice_date, 'YYYY-MM') = ${code}) as open_exceptions,
        (select count(*)::int from erp.bank_transaction where status = 'unmatched'
          and to_char(txn_date, 'YYYY-MM') = ${code}) as unmatched_bank,
        (select count(*)::int from erp.journal where book <> 'test' and period_code = ${code}) as journals
    `)
  ).rows as { balance: string; failed_events: number; open_exceptions: number; unmatched_bank: number; journals: number }[];
  return [
    {
      id: "balance",
      label: "Books balance to zero",
      level: "hard",
      ok: Number(g!.balance) === 0,
      detail: Number(g!.balance) === 0 ? `${g!.journals} journals, in balance` : `out of balance by ${Number(g!.balance)} minor units`,
    },
    {
      id: "events",
      label: "No failed platform events",
      level: "hard",
      ok: g!.failed_events === 0,
      detail: g!.failed_events === 0 ? "event store clean" : `${g!.failed_events} failed events need replay or correction`,
    },
    {
      id: "exceptions",
      label: "No open exceptions dated in the period",
      level: "warn",
      ok: g!.open_exceptions === 0,
      detail: g!.open_exceptions === 0 ? "exception queue clear for the month" : `${g!.open_exceptions} invoices still held — locking closes the month around them`,
    },
    {
      id: "bank",
      label: "Bank lines in the period matched",
      level: "warn",
      ok: g!.unmatched_bank === 0,
      detail: g!.unmatched_bank === 0 ? "bank fully reconciled" : `${g!.unmatched_bank} bank lines unmatched — they will reconcile into a later month`,
    },
  ];
}

/** Per-account movement for the period + closing balance through its end. */
async function snapshotLines(db: Db, code: string) {
  return (
    await db.execute(sql`
      select a.code as account_code,
             coalesce(sum(jl.amount_minor) filter (where j.period_code = ${code}), 0)::bigint as movement,
             coalesce(sum(jl.amount_minor) filter (where j.period_code <= ${code}), 0)::bigint as closing
      from erp.account a
      left join erp.journal_line jl on jl.account_code = a.code
      left join erp.journal j on j.id = jl.journal_id and j.book <> 'test'
      group by a.code
      having coalesce(sum(jl.amount_minor) filter (where j.period_code <= ${code}), 0) <> 0
          or coalesce(sum(jl.amount_minor) filter (where j.period_code = ${code}), 0) <> 0
      order by a.code
    `)
  ).rows as { account_code: string; movement: string; closing: string }[];
}

export async function lockPeriod(db: Db, code: string, lockedBy: string, acceptWarnings: boolean) {
  const period = await periodRow(db, code);
  if (period.status !== "open")
    throw Object.assign(new Error(`period ${code} is ${period.status} — only an open period locks`), { statusCode: 409 });
  const gates = await closeGates(db, code);
  const hardFails = gates.filter((x) => x.level === "hard" && !x.ok);
  if (hardFails.length > 0)
    throw Object.assign(new Error(`hard gate failed: ${hardFails.map((x) => x.label).join("; ")}`), { statusCode: 409, gates });
  const warns = gates.filter((x) => x.level === "warn" && !x.ok);
  if (warns.length > 0 && !acceptWarnings)
    throw Object.assign(new Error("warnings need explicit acceptance"), { statusCode: 428, gates });

  const lines = await snapshotLines(db, code);
  const [maxRow] = (
    await db.execute(sql`select coalesce(max(version), 0)::int as v from fdp.lrs_snapshot where period_code = ${code}`)
  ).rows as { v: number }[];
  const [{ journals, events, result }] = (
    await db.execute(sql`
      select
        (select count(*)::int from erp.journal where book <> 'test' and period_code = ${code}) as journals,
        (select count(*)::int from fdp.event where book <> 'test') as events,
        coalesce(-(select sum(jl.amount_minor) from erp.journal_line jl
          join erp.journal j on j.id = jl.journal_id and j.book <> 'test' and j.period_code = ${code}
          join erp.account a on a.code = jl.account_code and a.type in ('income', 'expense')), 0)::bigint as result
    `)
  ).rows as { journals: number; events: number; result: string }[];

  const [snap] = await db
    .insert(lrsSnapshot)
    .values({
      periodCode: code,
      version: (maxRow?.v ?? 0) + 1,
      status: "locked",
      summary: { journals, events, resultMinor: Number(result), accounts: lines.length, warningsAccepted: warns.map((w) => w.id) },
      lockedBy,
    })
    .returning();
  await db.insert(lrsSnapshotLine).values(
    lines.map((l) => ({
      snapshotId: snap!.id,
      accountCode: l.account_code,
      movementMinor: Number(l.movement),
      closingMinor: Number(l.closing),
    })),
  );
  await db.execute(sql`update core.fiscal_period set status = 'locked' where code = ${code}`);
  await emitActivity({
    actorType: "human",
    actorId: lockedBy,
    verb: "locked_period",
    objectType: "lrs_snapshot",
    objectId: snap!.id,
    summary: `Period ${code} locked — snapshot v${snap!.version}: ${lines.length} accounts, ${journals} journals, result £${(Number(result) / 100).toFixed(2)}. Postings into ${code} are now refused.`,
  });
  return { snapshot: snap!, lines: lines.length, gates };
}

export async function certifyPeriod(db: Db, code: string, certifiedBy: string) {
  const period = await periodRow(db, code);
  if (period.status !== "locked")
    throw Object.assign(new Error(`period ${code} is ${period.status} — only a locked period certifies`), { statusCode: 409 });
  const snap = await db.query.lrsSnapshot.findFirst({
    where: (t, { and, eq }) => and(eq(t.periodCode, code), eq(t.status, "locked")),
    orderBy: (t, { desc }) => desc(t.version),
  });
  if (!snap) throw Object.assign(new Error("no locked snapshot to certify"), { statusCode: 409 });
  await db.execute(sql`
    update fdp.lrs_snapshot set status = 'certified', certified_by = ${certifiedBy}, certified_at = now()
    where id = ${snap.id}
  `);
  await db.execute(sql`update core.fiscal_period set status = 'certified' where code = ${code}`);
  await emitActivity({
    actorType: "human",
    actorId: certifiedBy,
    verb: "certified_period",
    objectType: "lrs_snapshot",
    objectId: snap.id,
    summary: `Period ${code} certified — snapshot v${snap.version} is now the immutable record. Changes from here are restatements, never edits.`,
  });
  return { snapshotId: snap.id, version: snap.version };
}

export async function restatePeriod(db: Db, code: string, reason: string, requestedBy: string) {
  const period = await periodRow(db, code);
  if (period.status !== "locked" && period.status !== "certified")
    throw Object.assign(new Error(`period ${code} is ${period.status} — nothing to restate`), { statusCode: 409 });
  await db.execute(sql`
    update fdp.lrs_snapshot set status = 'superseded', superseded_at = now(), superseded_reason = ${reason}
    where period_code = ${code} and status in ('locked', 'certified')
  `);
  await db.execute(sql`update core.fiscal_period set status = 'open' where code = ${code}`);
  await emitActivity({
    actorType: "human",
    actorId: requestedBy,
    verb: "restated_period",
    objectType: "fiscal_period",
    objectId: period.id,
    summary: `Period ${code} reopened for restatement — ${reason}. The superseded snapshot stays on the record; the next lock writes the next version.`,
  });
  return { reopened: code };
}

/** Does the live ledger still reconcile to the certified snapshot? The
 * posting guard should make divergence impossible — this check proves it
 * rather than asserts it. */
export async function reconcileToSnapshot(db: Db, snapshotId: string) {
  const snap = await db.query.lrsSnapshot.findFirst({ where: (t, { eq }) => eq(t.id, snapshotId) });
  if (!snap) throw Object.assign(new Error("snapshot not found"), { statusCode: 404 });
  const stored = await db.query.lrsSnapshotLine.findMany({ where: (t, { eq }) => eq(t.snapshotId, snapshotId) });
  const live = await snapshotLines(db, snap.periodCode);
  const liveAt = new Map(live.map((l) => [l.account_code, { m: Number(l.movement), c: Number(l.closing) }]));
  const diffs: string[] = [];
  for (const s of stored) {
    const l = liveAt.get(s.accountCode) ?? { m: 0, c: 0 };
    if (l.m !== s.movementMinor || l.c !== s.closingMinor)
      diffs.push(`${s.accountCode}: movement ${s.movementMinor} → ${l.m}, closing ${s.closingMinor} → ${l.c}`);
    liveAt.delete(s.accountCode);
  }
  for (const [code, l] of liveAt) if (l.m !== 0) diffs.push(`${code}: not in snapshot, live movement ${l.m}`);
  return { reconciles: diffs.length === 0, diffs: diffs.slice(0, 5) };
}
