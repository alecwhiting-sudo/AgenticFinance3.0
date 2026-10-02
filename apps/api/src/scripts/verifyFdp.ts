/** FDP invariant check (D13 / analysis §2.3, §8): run after any load or
 * replay. Exits non-zero if the platform's architectural invariants fail:
 *   1. no movement without an event; every processed event has movements
 *   2. per event: movements balance to zero
 *   3. movements mirror journal lines exactly (same accounts, same amounts)
 *   4. LES (sum of movements) reconciles to the GL for platform journals
 *   5. no failed events outstanding
 */
import { sql } from "drizzle-orm";
import { createDb } from "@af/db";

const { db, pool } = createDb();
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error(` ✗ ${msg}`);
};

const one = async <T>(q: ReturnType<typeof sql>): Promise<T> =>
  ((await db.execute(q)).rows[0] ?? {}) as T;

// 1. orphans
const { n: orphanMovements } = await one<{ n: number }>(
  sql`select count(*)::int as n from fdp.movement m left join fdp.event e on e.id = m.event_id where e.id is null`,
);
if (orphanMovements > 0) fail(`${orphanMovements} movements without an event`);
const { n: emptyProcessed } = await one<{ n: number }>(
  sql`select count(*)::int as n from fdp.event e where e.status = 'processed'
      and not exists (select 1 from fdp.movement m where m.event_id = e.id)`,
);
if (emptyProcessed > 0) fail(`${emptyProcessed} processed events with no movements`);

// 2. per-event balance
const { n: unbalanced } = await one<{ n: number }>(
  sql`select count(*)::int as n from (
        select event_id from fdp.movement group by event_id having sum(amount_minor) <> 0
      ) x`,
);
if (unbalanced > 0) fail(`${unbalanced} events whose movements do not balance`);

// 3. movements mirror journal lines (account-level sums per journal)
const { n: mirrorBreaks } = await one<{ n: number }>(
  sql`select count(*)::int as n from (
        select coalesce(m.journal_id, jl.journal_id) as jid
        from (select journal_id, account_code, sum(amount_minor) s from fdp.movement group by 1,2) m
        full outer join (
          select jl.journal_id, jl.account_code, sum(jl.amount_minor) s
          from erp.journal_line jl
          where jl.journal_id in (select distinct journal_id from fdp.movement)
          group by 1,2
        ) jl on jl.journal_id = m.journal_id and jl.account_code = m.account_code
        where m.s is distinct from jl.s
      ) x`,
);
if (mirrorBreaks > 0) fail(`${mirrorBreaks} journal/movement account mismatches`);

// 4. LES reconciles to GL for platform journals
const { total } = await one<{ total: string }>(
  sql`select coalesce(sum(balance_minor),0)::bigint as total from fdp.les_account`,
);
if (Number(total) !== 0) fail(`LES does not balance (sum ${total})`);

// 5. failed events
const { n: failed } = await one<{ n: number }>(
  sql`select count(*)::int as n from fdp.event where status = 'failed'`,
);
if (failed > 0) fail(`${failed} failed events outstanding`);

const stats = await one<{ events: number; movements: number; journals: number }>(
  sql`select (select count(*)::int from fdp.event) as events,
             (select count(*)::int from fdp.movement) as movements,
             (select count(distinct journal_id)::int from fdp.movement) as journals`,
);
console.log(
  `fdp verify: ${stats.events} events, ${stats.movements} movements, ${stats.journals} platform journals — ${failures === 0 ? "all invariants hold" : `${failures} FAILURES`}`,
);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
