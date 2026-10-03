import {
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
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

/* ------------------------------------------------------------------ */
/* agent schema — framework: registry, skills, releases, queue, runs,  */
/* commands, evals, activity (ARCHITECTURE.md §3, §4, §5, §6a)         */
/* ------------------------------------------------------------------ */

export const ag = pgSchema("agent");

export const agentStatus = ag.enum("agent_status", ["active", "paused", "retired"]);
export const releaseStatus = ag.enum("release_status", [
  "draft",
  "evaluated",
  "active",
  "retired",
]);
export const workItemStatus = ag.enum("work_item_status", [
  "pending",
  "claimed",
  "running",
  "completed",
  "escalated",
  "failed",
]);
export const runOutcome = ag.enum("run_outcome", [
  "completed",
  "escalated",
  "failed",
  "abstained",
]);
export const commandStatus = ag.enum("command_status", [
  "proposed",
  "approved",
  "rejected",
  "executed",
  "failed",
]);
export const evalRunStatus = ag.enum("eval_run_status", ["running", "passed", "failed"]);

export const agent = ag.table("agent", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // e.g. hello-finance
  name: text("name").notNull(),
  purpose: text("purpose").notNull(),
  owner: text("owner").notNull(),
  /** Process family (modules are families for agents, D13): p2p | r2r | o2c | pm | platform */
  process: text("process").notNull().default("platform"),
  status: agentStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skill = ag.table("skill", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillVersion = ag.table(
  "skill_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id").notNull().references(() => skill.id),
    version: integer("version").notNull(), // 1, 2, 3…
    instructions: text("instructions").notNull(), // markdown
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("skill_version_unique").on(t.skillId, t.version)],
);

export const agentRelease = ag.table(
  "agent_release",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agent.id),
    version: integer("version").notNull(),
    instructions: text("instructions").notNull(), // system prompt core
    skillVersionIds: jsonb("skill_version_ids").$type<string[]>().notNull().default([]),
    /** command types this release may propose, e.g. ["case.update"] */
    commandPermissions: jsonb("command_permissions").$type<string[]>().notNull().default([]),
    /** "none" = deterministic handler only; otherwise env var suffix, e.g. "default" -> ANTHROPIC_MODEL */
    modelProfile: text("model_profile").notNull().default("default"),
    maxModelCalls: integer("max_model_calls").notNull().default(10),
    maxCostMinor: integer("max_cost_minor").notNull().default(100), // pence cap per run
    status: releaseStatus("status").notNull().default("draft"),
    evalRunId: uuid("eval_run_id"),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    promotedBy: text("promoted_by"),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
  },
  (t) => [unique("agent_release_unique").on(t.agentId, t.version)],
);

export const workItem = ag.table("work_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(), // e.g. hello.greet — routed to an agent
  agentId: uuid("agent_id").references(() => agent.id), // assigned agent
  caseId: uuid("case_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: workItemStatus("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(5),
  attempts: integer("attempts").notNull().default(0),
  claimedBy: text("claimed_by"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const agentRun = ag.table("agent_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agent.id),
  releaseId: uuid("release_id").notNull().references(() => agentRelease.id),
  workItemId: uuid("work_item_id").references(() => workItem.id),
  evalCaseId: uuid("eval_case_id"), // set when run by the eval harness
  /** ordered steps: {kind: note|model_call|tool_call|command|outcome, ...} */
  transcript: jsonb("transcript").$type<Record<string, unknown>[]>().notNull().default([]),
  modelCalls: integer("model_calls").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0), // uncached input only
  outputTokens: integer("output_tokens").notNull().default(0),
  // Prompt-caching split, stored RAW — all pricing (rates and cache
  // multipliers) is applied at read time by the API's rateCard, so price
  // moves never require rewriting history.
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  outcome: runOutcome("outcome"),
  resultSummary: text("result_summary"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const command = ag.table("command", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  runId: uuid("run_id").references(() => agentRun.id),
  agentId: uuid("agent_id").references(() => agent.id),
  releaseId: uuid("release_id").references(() => agentRelease.id),
  status: commandStatus("status").notNull().default("proposed"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  decidedBy: text("decided_by"),
  decisionReason: text("decision_reason"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const evalCase = ag.table("eval_case", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agent.id),
  name: text("name").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  /** assertions: [{kind: "outcome"|"summary_contains"|"summary_not_contains"|"command_proposed"|"not_command_proposed", value: string}] */
  assertions: jsonb("assertions").$type<{ kind: string; value: string }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evalRun = ag.table("eval_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agent.id),
  releaseId: uuid("release_id").notNull().references(() => agentRelease.id),
  status: evalRunStatus("status").notNull().default("running"),
  /** per case: {evalCaseId, runId, passed, failures: string[]} */
  results: jsonb("results").$type<Record<string, unknown>[]>().notNull().default([]),
  passed: integer("passed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const activityEvent = ag.table("activity_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  actorType: text("actor_type").notNull(), // agent | human | system
  actorId: text("actor_id").notNull(), // agent slug, user email, or service name
  verb: text("verb").notNull(), // claimed | called_tool | proposed | approved | posted | …
  objectType: text("object_type"),
  objectId: text("object_id"),
  caseId: uuid("case_id"),
  summary: text("summary").notNull(),
});

/* ------------------------------------------------------------------ */
/* evidence schema — documents, cases, timelines (ARCHITECTURE.md §3)  */
/* ------------------------------------------------------------------ */

export const ev = pgSchema("evidence");

export const caseStatus = ev.enum("case_status", ["open", "waiting_approval", "resolved", "escalated"]);

export const evidenceCase = ev.table("case", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // e.g. invoice-exception
  title: text("title").notNull(),
  status: caseStatus("status").notNull().default("open"),
  ownerAgentId: uuid("owner_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const document = ev.table("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  sha256: text("sha256").notNull(),
  mime: text("mime").notNull(),
  filename: text("filename").notNull(),
  storagePath: text("storage_path").notNull(), // relative path under the seed/doc root
  caseId: uuid("case_id").references(() => evidenceCase.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const caseEvent = ev.table("case_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id").notNull().references(() => evidenceCase.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  kind: text("kind").notNull(), // note | decision | document | command | status_change
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
});

/* ------------------------------------------------------------------ */
/* erp: GL + P2P (unified Purchase model — plans/P2P.md §2, D12)       */
/* ------------------------------------------------------------------ */

export const journalStatus = erp.enum("journal_status", ["draft", "posted", "reversed"]);

export const journal = erp.table("journal", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => company.id),
  number: integer("number").notNull().unique(), // sequential, assigned at posting
  journalDate: date("journal_date").notNull(),
  periodCode: text("period_code").notNull(), // e.g. 2026-04
  memo: text("memo").notNull(),
  sourceType: text("source_type").notNull(), // ap_invoice | ap_payment | manual | ...
  sourceId: text("source_id").notNull(),
  status: journalStatus("status").notNull().default("posted"),
  reversesJournalId: uuid("reverses_journal_id"),
  postedBy: text("posted_by").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("journal_source_unique").on(t.sourceType, t.sourceId)]);

export const journalLine = erp.table("journal_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  journalId: uuid("journal_id").notNull().references(() => journal.id),
  lineNo: integer("line_no").notNull(),
  accountCode: text("account_code").notNull(),
  // signed minor units: positive = debit, negative = credit; sum per journal = 0
  amountMinor: integer("amount_minor").notNull(),
  memo: text("memo"),
});

export const purchaseStatus = erp.enum("purchase_status", [
  "requested",
  "approved",
  "partially_received",
  "received",
  "closed",
  "rejected",
  "cancelled",
]);
export const approvalBand = erp.enum("approval_band", ["auto", "standard", "director"]);

export type PurchaseLine = {
  lineNo: number;
  description: string;
  qty: number;
  unitPriceMinor: number;
  accountCode: string;
};

/** The unified Purchase: requisition and PO are one record (D12). */
export const purchase = erp.table("purchase", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(), // PO-26xxxx — doubles as the supplier-facing reference
  supplierId: uuid("supplier_id").notNull().references(() => supplier.id),
  requestedBy: text("requested_by").notNull(),
  businessNeed: text("business_need").notNull(),
  requestDate: date("request_date").notNull(),
  approvalBand: approvalBand("approval_band"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  orderDate: date("order_date"), // set at approval — when the supplier view is issued
  lines: jsonb("lines").$type<PurchaseLine[]>().notNull(),
  totalMinor: integer("total_minor").notNull(), // ex VAT
  status: purchaseStatus("status").notNull().default("requested"),
  documentPath: text("document_path"), // rendered supplier view
  caseId: uuid("case_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goodsReceipt = erp.table("goods_receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(),
  purchaseId: uuid("purchase_id").notNull().references(() => purchase.id),
  receiptDate: date("receipt_date").notNull(),
  /** qty received per purchase line, keyed by lineNo */
  quantities: jsonb("quantities").$type<{ lineNo: number; qtyReceived: number }[]>().notNull(),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apInvoiceStatus = erp.enum("ap_invoice_status", [
  "captured",
  "matched",
  "exception",
  "approved",
  "posted",
  "scheduled",
  "paid",
  "rejected",
]);

export const apInvoice = erp.table("ap_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull().references(() => supplier.id),
  supplierInvoiceNumber: text("supplier_invoice_number").notNull(),
  purchaseId: uuid("purchase_id").references(() => purchase.id),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date").notNull(),
  lines: jsonb("lines").$type<PurchaseLine[]>().notNull(),
  netMinor: integer("net_minor").notNull(),
  vatMinor: integer("vat_minor").notNull(),
  grossMinor: integer("gross_minor").notNull(),
  status: apInvoiceStatus("status").notNull().default("captured"),
  exceptionCode: text("exception_code"),
  caseId: uuid("case_id"),
  documentPath: text("document_path"),
  emailPath: text("email_path"),
  /** How the invoice arrived: text_pdf | scan_pdf (image only) | ubl_xml. */
  format: text("format").notNull().default("text_pdf"),
  journalId: uuid("journal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("ap_invoice_supplier_number").on(t.supplierId, t.supplierInvoiceNumber)]);

export const apPaymentStatus = erp.enum("ap_payment_status", [
  "proposed",
  "approved",
  "executed",
  "reconciled",
  "rejected",
]);

export const apPayment = erp.table("ap_payment", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentRef: text("payment_ref").notNull().unique(),
  runDate: date("run_date").notNull(),
  invoiceIds: jsonb("invoice_ids").$type<string[]>().notNull(),
  totalMinor: integer("total_minor").notNull(),
  status: apPaymentStatus("status").notNull().default("proposed"),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  journalId: uuid("journal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bankTxnStatus = erp.enum("bank_txn_status", ["unmatched", "matched"]);

export const bankTransaction = erp.table("bank_transaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  txnDate: date("txn_date").notNull(),
  amountMinor: integer("amount_minor").notNull(), // positive = money in
  reference: text("reference").notNull(),
  counterparty: text("counterparty").notNull(),
  kind: text("kind").notNull(), // ap_payment | ar_receipt | salaries | vat | bank_fees
  status: bankTxnStatus("status").notNull().default("unmatched"),
  matchedType: text("matched_type"),
  matchedId: text("matched_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Commitment accounting lite (plans/P2P.md §2): drives the auto band. */
export const categoryBudget = erp.table("category_budget", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountCode: text("account_code").notNull(),
  periodCode: text("period_code").notNull(),
  budgetMinor: integer("budget_minor").notNull(),
  committedMinor: integer("committed_minor").notNull().default(0),
  actualMinor: integer("actual_minor").notNull().default(0),
}, (t) => [unique("category_budget_unique").on(t.accountCode, t.periodCode)]);

/* ================= Finance Data Platform (D13, analysis/finance-data-platform.md) =================
 * Event-native economic substrate under the module surface. One pipe:
 * event (with account-coded deltas attached, or derived later by an engine)
 * → immutable movement rows + balanced journal, atomically. Modules stay
 * the client-facing surface; these tables are the store+ledger combined. */

export const fdp = pgSchema("fdp");

export const fdpEventStatus = fdp.enum("fdp_event_status", ["pending", "processed", "failed"]);

/** Append-only event store — the sole root of economic truth. Idempotency
 * via unique (source_system, source_event_key). Immutable except status
 * (enforced by trigger in the migration). */
export const fdpEvent = fdp.table("event", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(), // e.g. ap.invoice.posted, ap.payment.executed
  occurredAt: timestamp("occurred_at_utc", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at_utc", { withTimezone: true }).notNull().defaultNow(),
  sourceSystem: text("source_system").notNull(), // loader | api | worker | drip …
  sourceEventKey: text("source_event_key").notNull(),
  /** The economic object this event is about (invoice, payment run, …). */
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  /** Finance-initiated flows attach proposed account-coded deltas (D13's
   * "two entry postures, one pipe"); business-initiated flows leave this
   * null and an engine derives the deltas. Minor units; must sum to 0. */
  deltas: jsonb("deltas").$type<{ accountCode: string; amountMinor: number; memo?: string }[] | null>(),
  status: fdpEventStatus("status").notNull().default("pending"),
  error: text("error"),
}, (t) => [unique("fdp_event_idempotency").on(t.sourceSystem, t.sourceEventKey)]);

/** Immutable movement ledger: one row per (event, account). Account-coded
 * deltas ARE the grain; live balances (LES) are sums over this table.
 * Invariant: per event, sum(amount_minor) = 0 and rows mirror the journal. */
export const fdpMovement = fdp.table("movement", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => fdpEvent.id),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  accountCode: text("account_code").notNull(),
  amountMinor: integer("amount_minor").notNull(), // debit positive, credit negative
  memo: text("memo"),
  journalId: uuid("journal_id").notNull(), // the SDJ/GOJ this delta is represented by
  engineVersion: text("engine_version").notNull(),
  processedAt: timestamp("processed_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

/** Versioned parameter sets for future measurement transformations (accrual
 * patterns, recognition schedules — R2R). Immutable once approved. */
export const fdpParameterSet = fdp.table("parameter_set", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | active | retired
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Agent-drafted flux/variance commentary per period (plans/R2R.md §5).
 * Always a draft until a human regenerates or edits; display-only. */
export const reportCommentary = erp.table("report_commentary", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodCode: text("period_code").notNull(),
  text: text("text").notNull(),
  runId: uuid("run_id"),
  draftedBy: text("drafted_by").notNull(), // agent slug or human
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ================= O2C (plans/O2C.md) ================= */

export const arInvoiceStatus = erp.enum("ar_invoice_status", ["issued", "posted", "paid"]);

export const arInvoice = erp.table("ar_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: text("number").notNull().unique(),
  customerId: uuid("customer_id").notNull().references(() => customer.id),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date").notNull(),
  lines: jsonb("lines").$type<PurchaseLine[]>().notNull(),
  netMinor: integer("net_minor").notNull(),
  vatMinor: integer("vat_minor").notNull(),
  grossMinor: integer("gross_minor").notNull(),
  status: arInvoiceStatus("status").notNull().default("issued"),
  documentPath: text("document_path"),
  contractPath: text("contract_path"),
  remittancePath: text("remittance_path"),
  journalId: uuid("journal_id"),
  receiptJournalId: uuid("receipt_journal_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Sent dunning letters (plans/O2C.md §5) — always human-approved before
 * recording; sending is simulated in the demo. */
export const arDunning = erp.table("ar_dunning", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull().references(() => arInvoice.id),
  text: text("text").notNull(),
  sentBy: text("sent_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Compact per-eval-run rollup (D14): survives demo data flushes so agent
 * performance is comparable period on period while raw eval_run rows and
 * transcripts can be pruned to keep the demo cheap. Append-only. */
export const evalSummary = ag.table("eval_summary", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agent.id),
  releaseVersion: integer("release_version").notNull(),
  periodCode: text("period_code").notNull(), // YYYY-MM of the run
  passed: integer("passed").notNull(),
  failed: integer("failed").notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
});
