/**
 * Seed the database with Brightline Ltd starter data from seed/brightline.json.
 *
 * `--reset` truncates the seeded tables first so every demo starts pristine.
 * Idempotent without --reset: existing rows (matched by code) are left alone.
 * The Demo Data Studio (Phase 1) extends this with transaction history; this
 * script stays the deterministic entry point that never calls an LLM.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import {
  account,
  company,
  createDb,
  customer,
  fiscalPeriod,
  item,
  supplier,
} from "./index.js";

type SeedFile = {
  company: { code: string; name: string; currency: string };
  periods: { firstMonth: string; months: number };
  accounts: { code: string; name: string; type: string }[];
  suppliers: { code: string; name: string; email: string; paymentTermsDays: number }[];
  customers: { code: string; name: string; email: string; paymentTermsDays: number }[];
  items: { code: string; name: string; kind: string; unitPriceMinor: number }[];
};

const seedPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../seed/brightline.json",
);
const data: SeedFile = JSON.parse(readFileSync(seedPath, "utf8"));
const reset = process.argv.includes("--reset");

const { db, pool } = createDb();

if (reset) {
  await db.execute(sql`
    truncate table erp.item, erp.customer, erp.supplier, erp.account,
      core.fiscal_period, core.company cascade
  `);
  console.log("existing seed data truncated");
}

const [co] = await db
  .insert(company)
  .values(data.company)
  .onConflictDoNothing({ target: company.code })
  .returning();
const companyRow =
  co ??
  (await db.query.company.findFirst({
    where: (c, { eq }) => eq(c.code, data.company.code),
  }));
if (!companyRow) throw new Error("company row missing after insert");
const companyId = companyRow.id;

const [startYear, startMonth] = data.periods.firstMonth
  .split("-")
  .map(Number) as [number, number];
const periods = Array.from({ length: data.periods.months }, (_, i) => {
  const start = new Date(Date.UTC(startYear, startMonth - 1 + i, 1));
  const end = new Date(Date.UTC(startYear, startMonth + i, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    companyId,
    code: iso(start).slice(0, 7),
    startDate: iso(start),
    endDate: iso(end),
    status: "open" as const,
  };
});
await db.insert(fiscalPeriod).values(periods).onConflictDoNothing();

await db
  .insert(account)
  .values(data.accounts.map((a) => ({ ...a, companyId }) as typeof account.$inferInsert))
  .onConflictDoNothing({ target: account.code });
await db
  .insert(supplier)
  .values(data.suppliers.map((s) => ({ ...s, companyId })))
  .onConflictDoNothing({ target: supplier.code });
await db
  .insert(customer)
  .values(data.customers.map((c) => ({ ...c, companyId })))
  .onConflictDoNothing({ target: customer.code });
await db
  .insert(item)
  .values(data.items.map((i) => ({ ...i, companyId })))
  .onConflictDoNothing({ target: item.code });

console.log(
  `seeded ${data.company.name}: ${data.accounts.length} accounts, ` +
    `${data.suppliers.length} suppliers, ${data.customers.length} customers, ` +
    `${data.items.length} items, ${periods.length} periods`,
);
await pool.end();
