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
import type { Db } from "./client.js";
import {
  account,
  agent,
  agentRelease,
  company,
  customer,
  evalCase,
  fiscalPeriod,
  item,
  skill,
  skillVersion,
  supplier,
} from "./schema.js";

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

export async function seedCore(db: Db, reset = false): Promise<void> {
const data: SeedFile = JSON.parse(readFileSync(seedPath, "utf8"));
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

// ---- agent framework seed (idempotent; reset truncates these too) ----
type AgentSeed = {
  skills: { slug: string; name: string; description: string; instructions: string }[];
  agents: {
    slug: string;
    name: string;
    purpose: string;
    owner: string;
    release: {
      instructions: string;
      skills: string[];
      commandPermissions: string[];
      modelProfile: string;
      maxModelCalls: number;
      maxCostMinor: number;
      notes?: string;
    };
    evalCases: { name: string; input: Record<string, unknown>; assertions: { kind: string; value: string }[] }[];
  }[];
};
const agentSeedPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../seed/agents.json",
);
const agentData: AgentSeed = JSON.parse(readFileSync(agentSeedPath, "utf8"));

if (reset) {
  await db.execute(sql`
    truncate table agent.activity_event, agent.eval_run, agent.eval_case,
      agent.command, agent.agent_run, agent.work_item, agent.agent_release,
      agent.skill_version, agent.skill, agent.agent,
      evidence.case_event, evidence.document, evidence."case" cascade
  `);
}

const skillVersionBySlug = new Map<string, string>();
for (const s of agentData.skills) {
  const [row] = await db
    .insert(skill)
    .values({ slug: s.slug, name: s.name, description: s.description })
    .onConflictDoNothing({ target: skill.slug })
    .returning();
  const skillRow =
    row ?? (await db.query.skill.findFirst({ where: (t, { eq }) => eq(t.slug, s.slug) }));
  if (!skillRow) throw new Error(`skill ${s.slug} missing`);
  const existingV1 = await db.query.skillVersion.findFirst({
    where: (t, { and, eq }) => and(eq(t.skillId, skillRow.id), eq(t.version, 1)),
  });
  const v1 =
    existingV1 ??
    (
      await db
        .insert(skillVersion)
        .values({ skillId: skillRow.id, version: 1, instructions: s.instructions, createdBy: "seed" })
        .returning()
    )[0]!;
  skillVersionBySlug.set(s.slug, v1.id);
}

for (const a of agentData.agents) {
  const [row] = await db
    .insert(agent)
    .values({ slug: a.slug, name: a.name, purpose: a.purpose, owner: a.owner })
    .onConflictDoNothing({ target: agent.slug })
    .returning();
  const agentRow =
    row ?? (await db.query.agent.findFirst({ where: (t, { eq }) => eq(t.slug, a.slug) }));
  if (!agentRow) throw new Error(`agent ${a.slug} missing`);

  const existingRelease = await db.query.agentRelease.findFirst({
    where: (t, { and, eq }) => and(eq(t.agentId, agentRow.id), eq(t.version, 1)),
  });
  if (!existingRelease) {
    await db.insert(agentRelease).values({
      agentId: agentRow.id,
      version: 1,
      instructions: a.release.instructions,
      skillVersionIds: a.release.skills.map((slug) => {
        const id = skillVersionBySlug.get(slug);
        if (!id) throw new Error(`unknown skill ${slug}`);
        return id;
      }),
      commandPermissions: a.release.commandPermissions,
      modelProfile: a.release.modelProfile,
      maxModelCalls: a.release.maxModelCalls,
      maxCostMinor: a.release.maxCostMinor,
      status: "active",
      notes: a.release.notes,
      createdBy: "seed",
      promotedBy: "seed",
      promotedAt: new Date(),
    });
  }

  for (const c of a.evalCases) {
    const existing = await db.query.evalCase.findFirst({
      where: (t, { and, eq }) => and(eq(t.agentId, agentRow.id), eq(t.name, c.name)),
    });
    if (!existing) {
      await db
        .insert(evalCase)
        .values({ agentId: agentRow.id, name: c.name, input: c.input, assertions: c.assertions });
    }
  }
}

console.log(
  `seeded agent framework: ${agentData.skills.length} skills, ${agentData.agents.length} agents`,
);
}


// CLI entry: tsx src/seed.ts [--reset]
if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  const { createDb } = await import("./client.js");
  const { db, pool } = createDb();
  await seedCore(db, process.argv.includes("--reset"));
  await pool.end();
}
