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
      /** The IBAN printed on the invoice, when one is — intake checks it
       * against the supplier master (bank_detail_mismatch, human-only). */
      ibanOnInvoice: z.string().max(40).optional(),
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
  /** Save a drafted board pack's sections onto its row (plans/DATASET_V2.md
   * PR-G). Display-only text for human review — standing authority; the
   * pack never leaves the workbench without a person exporting it. */
  "report.board_pack.save": {
    requiresApproval: false,
    params: z.object({
      packId: z.string().uuid(),
      title: z.string().min(1).max(160),
      sections: z
        .array(
          z.object({
            id: z.string().min(1).max(40),
            heading: z.string().min(1).max(120),
            body: z.string().min(1).max(6000),
            figures: z
              .array(z.object({ label: z.string().max(80), value: z.string().max(40) }))
              .max(8)
              .optional(),
          }),
        )
        .min(3)
        .max(10),
      sources: z.array(z.string().max(120)).min(1).max(20),
    }),
  },
  /** Apply a customer receipt to an AR invoice — a judgement call when the
   * deterministic matcher couldn't decide, so ALWAYS human-approved
   * (plans/O2C.md §4). */
  "ar.receipt.apply": {
    requiresApproval: true,
    params: z.object({
      bankTransactionId: z.string().uuid(),
      invoiceId: z.string().uuid(),
      rationale: z.string().min(10).max(2000),
    }),
  },
  /** Send a dunning letter — external communication, ALWAYS human-approved
   * (CLAUDE.md finance safety rule; plans/O2C.md §5). Send is simulated. */
  "ar.dunning.send": {
    requiresApproval: true,
    params: z.object({
      invoiceId: z.string().uuid(),
      text: z.string().min(80).max(4000),
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
  /** Attach grounded resolution OPTIONS to an exception case (plans/P2P.md
   * §10): the agent's 2–3 alternatives, each mapping to a typed resolution a
   * human can apply from the exceptions workbench. Display-only — writing
   * options moves no money, so standing authority. "human_verify" marks a
   * guidance-only option (e.g. bank-detail-change: verify out of band). */
  "case.options": {
    requiresApproval: false,
    params: z.object({
      caseId: z.string().uuid(),
      options: z
        .array(
          z.object({
            resolution: z.enum([
              "approve_adjusted",
              "part_approve",
              "record_receipt",
              "reject",
              "retro_purchase",
              "human_verify",
              // AR receipt-query options (plans/O2C.md §9 mirror)
              "apply_residual",
              "refund_overpay",
              "hold_query",
            ]),
            label: z.string().min(3).max(140),
            rationale: z.string().min(10).max(1000),
            costedNote: z.string().max(200).optional(),
            /** Display-only supplier/customer letter attached to the option
             * (plans/P2P.md §10 M2) — a human copies it out; NOTHING is ever
             * sent automatically, and fraud-risk cases carry no draft. */
            emailDraft: z
              .object({
                to: z.string().min(3).max(120),
                subject: z.string().min(3).max(140),
                body: z.string().min(20).max(2000),
              })
              .optional(),
            adjustedQuantities: z
              .array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().min(0) }))
              .optional(),
          }),
        )
        .min(1)
        .max(4),
    }),
  },
  /** Open an evidence case — display-only bookkeeping of a question that
   * needs a human (the O2C receipt-query mirror opens these); no books
   * move, so standing authority applies like case.note/case.options. */
  "case.open": {
    requiresApproval: false,
    params: z.object({
      kind: z.string().min(3).max(40),
      title: z.string().min(3).max(140),
      detail: z.record(z.string(), z.unknown()).default({}),
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

/** ---- Period lens (plans/DATASET_V2.md PR-B) -------------------------------
 * One shared way to say "show me this month / quarter / year-to-date" across
 * the trial balance, statements and analytics. A lens is a short string that
 * fits in a URL and resolves to an inclusive month-code window:
 *   "2026-09"      → month    (from 2026-09 to 2026-09)
 *   "2026-Q3"      → quarter  (from 2026-07 to 2026-09)
 *   "ytd@2026-09"  → YTD      (from 2026-01 to 2026-09; FY = calendar year)
 * APIs take plain from/to month codes so they stay lens-agnostic; the web
 * resolves the lens once and passes the window. */
export type PeriodGrain = "month" | "quarter" | "ytd";
export type ResolvedLens = {
  grain: PeriodGrain;
  /** canonical lens string (what goes in the URL) */
  lens: string;
  /** inclusive month-code window */
  from: string;
  to: string;
  /** human label, e.g. "Sep 2026" / "Q3 2026" / "YTD Sep 2026" */
  label: string;
};

const MONTH_CODE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthLabel = (p: string): string =>
  new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** The quarter lens string containing a month, e.g. 2026-08 → 2026-Q3. */
export const quarterOfMonth = (p: string): string =>
  `${p.slice(0, 4)}-Q${Math.ceil(Number(p.slice(5, 7)) / 3)}`;

/** The canonical lens string for a grain anchored at a month. */
export const lensForGrain = (grain: PeriodGrain, month: string): string =>
  grain === "month" ? month : grain === "quarter" ? quarterOfMonth(month) : `ytd@${month}`;

/** Last calendar day of a month code — the as-of date for open-item views. */
export const monthEndDate = (p: string): string => {
  const [y, m] = p.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function parsePeriodLens(lens: string | null | undefined): ResolvedLens | null {
  if (!lens) return null;
  if (MONTH_CODE.test(lens))
    return { grain: "month", lens, from: lens, to: lens, label: monthLabel(lens) };
  const q = /^(\d{4})-[Qq]([1-4])$/.exec(lens);
  if (q) {
    const year = q[1]!;
    const n = Number(q[2]);
    const pad = (m: number) => String(m).padStart(2, "0");
    return {
      grain: "quarter",
      lens: `${year}-Q${n}`,
      from: `${year}-${pad(3 * n - 2)}`,
      to: `${year}-${pad(3 * n)}`,
      label: `Q${n} ${year}`,
    };
  }
  const y = /^ytd@(\d{4}-\d{2})$/i.exec(lens);
  if (y && MONTH_CODE.test(y[1]!))
    return {
      grain: "ytd",
      lens: `ytd@${y[1]}`,
      from: `${y[1]!.slice(0, 4)}-01`,
      to: y[1]!,
      label: `YTD ${monthLabel(y[1]!)}`,
    };
  return null;
}

/** ---- Chat-built analytics boards (plans/DATASET_V2.md PR-E) --------------
 * A board is a page of tiles; every tile references a CURATED VIEW by id,
 * with whitelisted params — grounded and book-filtered by construction,
 * never free-form SQL. The Analyst proposes a board as a `board:` JSON line
 * in its chat answer; the human confirms, which creates/updates the row. */
export const boardTileSchema = z.object({
  /** a curated view id from the catalogue */
  view: z.enum(["pl-trend", "flux", "aging", "counterparty", "cash"]),
  /** whitelisted view params (side, dim, period, year, from, to, asOf) */
  params: z.record(z.string().max(20)).default({}),
  /** optional tile heading; the view's own title otherwise */
  title: z.string().min(1).max(80).optional(),
  /** grid width: 1 = half row (default), 2 = full row */
  span: z.union([z.literal(1), z.literal(2)]).default(1),
});
export type BoardTile = z.infer<typeof boardTileSchema>;

export const boardSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes"),
  title: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  tiles: z.array(boardTileSchema).min(1).max(8),
});
export type Board = z.infer<typeof boardSchema>;
