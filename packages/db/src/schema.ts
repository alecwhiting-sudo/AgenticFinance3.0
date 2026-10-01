import {
  boolean,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const core = pgSchema("core");

export const company = core.table("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull(), // ISO 4217, single currency in demo
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const periodStatus = core.enum("period_status", ["open", "closed"]);

export const fiscalPeriod = core.table(
  "fiscal_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    code: text("code").notNull(), // e.g. 2026-04
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: periodStatus("status").notNull().default("open"),
  },
  (t) => [unique("fiscal_period_company_code").on(t.companyId, t.code)],
);

export const auditLog = core.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorType: text("actor_type").notNull(), // agent | human | system
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  objectType: text("object_type"),
  objectId: text("object_id"),
  detail: text("detail"),
});

export const erp = pgSchema("erp");

export const accountType = erp.enum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const account = erp.table("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => company.id),
  code: text("code").notNull().unique(), // e.g. 1100
  name: text("name").notNull(),
  type: accountType("type").notNull(),
  active: boolean("active").notNull().default(true),
});

export const supplier = erp.table("supplier", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => company.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  paymentTermsDays: integer("payment_terms_days"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customer = erp.table("customer", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => company.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  paymentTermsDays: integer("payment_terms_days"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const item = erp.table("item", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => company.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // good | service
  unitPriceMinor: integer("unit_price_minor"), // pence
  active: boolean("active").notNull().default(true),
});
