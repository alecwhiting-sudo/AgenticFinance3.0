import { z } from "zod";

/** Health status reported by every service at /health. */
export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  db: z.enum(["ok", "unavailable"]),
  version: z.string(),
  time: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

/** Company overview served by the API for the workbench dashboard. */
export const companyOverviewSchema = z.object({
  company: z.object({
    code: z.string(),
    name: z.string(),
    currency: z.string(),
  }),
  currentPeriod: z
    .object({ code: z.string(), status: z.enum(["open", "closed"]) })
    .nullable(),
  counts: z.object({
    accounts: z.number(),
    suppliers: z.number(),
    customers: z.number(),
    items: z.number(),
  }),
});
export type CompanyOverview = z.infer<typeof companyOverviewSchema>;

/* ---------------- agent framework contracts (Phase 1) ---------------- */

/** Registered command types and their payload schemas. The gateway rejects
 * anything not listed here. requiresApproval marks the human checkpoint. */
export const commandDefs = {
  "case.note": {
    requiresApproval: false,
    params: z.object({
      caseId: z.string().uuid().optional(),
      note: z.string().min(1).max(4000),
    }),
  },
  /** Create a Purchase in `requested` state (unified Purchase model, D12).
   * Standing authority: creating an ask moves no money. The deterministic
   * approval router then auto-approves the auto band or queues a human task. */
  "purchase.create": {
    requiresApproval: false,
    params: z.object({
      supplierCode: z.string().optional(),
      supplierName: z.string().optional(),
      requestedBy: z.string().min(1),
      businessNeed: z.string().min(3).max(1000),
      lines: z
        .array(
          z.object({
            description: z.string().min(1),
            qty: z.number().int().positive(),
            unitPriceMinor: z.number().int().positive(),
            accountCode: z.string().regex(/^\d{4}$/),
          }),
        )
        .min(1)
        .max(10),
    }),
  },
  /** Capture an extracted supplier invoice (standing: a draft moves no money).
   * The intake service then screens, matches, and posts or opens a case. */
  "ap.invoice.capture": {
    requiresApproval: false,
    params: z.object({
      supplierCode: z.string().min(1),
      supplierInvoiceNumber: z.string().min(1),
      purchaseNumber: z.string().optional(),
      invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      lines: z
        .array(
          z.object({
            description: z.string().min(1),
            qty: z.number().int().positive(),
            unitPriceMinor: z.number().int().positive(),
            accountCode: z.string().regex(/^\d{4}$/),
          }),
        )
        .min(1)
        .max(20),
      netMinor: z.number().int().positive(),
      vatMinor: z.number().int().min(0),
      grossMinor: z.number().int().positive(),
      emailText: z.string().max(8000).optional(),
      documentPath: z.string().optional(),
      emailPath: z.string().optional(),
    }),
  },
  /** Save a draft flux/variance commentary for a period. Display-only text,
   * no economic effect — standing authority (plans/R2R.md §5). */
  "report.commentary.save": {
    requiresApproval: false,
    params: z.object({
      periodCode: z.string().regex(/^\d{4}-\d{2}$/),
      text: z.string().min(40).max(8000),
    }),
  },
  /** Post an unmatched bank line against an account — a judgement call, so
   * ALWAYS a human approval (plans/R2R.md §2). Deterministic kind-rules never
   * use this; it exists for the Reconciliation Agent's proposals. */
  "bank.txn.post": {
    requiresApproval: true,
    params: z.object({
      bankTransactionId: z.string().uuid(),
      accountCode: z.string().regex(/^\d{4}$/),
      rationale: z.string().min(10).max(2000),
    }),
  },
  /** Resolve an invoice exception — ALWAYS a human approval (plans/P2P.md §6). */
  "ap.invoice.resolve": {
    requiresApproval: true,
    params: z.object({
      invoiceId: z.string().uuid(),
      resolution: z.enum(["approve_adjusted", "part_approve", "record_receipt", "reject", "retro_purchase"]),
      rationale: z.string().min(10).max(2000),
      adjustedQuantities: z
        .array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().min(0) }))
        .optional(),
    }),
  },
} as const;
export type CommandType = keyof typeof commandDefs;
export const commandTypeSchema = z.enum(
  Object.keys(commandDefs) as [CommandType, ...CommandType[]],
);

export const proposeCommandSchema = z.object({
  type: commandTypeSchema,
  params: z.record(z.unknown()),
  idempotencyKey: z.string().min(8).max(200),
  runId: z.string().uuid(),
});
export type ProposeCommand = z.infer<typeof proposeCommandSchema>;

export const createWorkItemSchema = z.object({
  type: z.string().min(1),
  agentSlug: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  priority: z.number().int().min(1).max(9).default(5),
});
export type CreateWorkItem = z.infer<typeof createWorkItemSchema>;

export const createSkillVersionSchema = z.object({
  instructions: z.string().min(1),
  createdBy: z.string().min(1),
});

export const createReleaseSchema = z.object({
  instructions: z.string().min(1),
  skillVersionIds: z.array(z.string().uuid()).default([]),
  commandPermissions: z.array(commandTypeSchema).default([]),
  modelProfile: z.string().default("default"),
  maxModelCalls: z.number().int().min(0).max(50).default(10),
  maxCostMinor: z.number().int().min(0).default(100),
  notes: z.string().optional(),
  createdBy: z.string().min(1),
});

export const promoteReleaseSchema = z.object({ promotedBy: z.string().min(1) });

/** Transcript step shapes persisted on agent_run.transcript. */
export const transcriptStepSchema = z.object({
  at: z.string(),
  kind: z.enum(["note", "model_call", "tool_call", "command", "outcome"]),
  label: z.string(),
  detail: z.record(z.unknown()).default({}),
});
export type TranscriptStep = z.infer<typeof transcriptStepSchema>;

/**
 * Activity events power the live experience layer (ARCHITECTURE.md §6a).
 */
export const activityEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  actorType: z.enum(["agent", "human", "system"]),
  actorId: z.string(),
  verb: z.string(),
  objectType: z.string().nullable(),
  objectId: z.string().nullable(),
  caseId: z.string().nullable(),
  summary: z.string(),
});
export type ActivityEvent = z.infer<typeof activityEventSchema>;
