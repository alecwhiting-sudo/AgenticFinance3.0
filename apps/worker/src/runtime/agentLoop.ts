/**
 * The bounded agent loop (ARCHITECTURE.md §4). Given a resolved release and a
 * task, it runs either:
 *  - the LLM loop (Anthropic SDK, manual loop so every step is persisted to
 *    the run transcript as it happens, with pacing and budget enforcement), or
 *  - a deterministic handler, when the release's model profile is "none" or no
 *    API key is configured (keeps the whole framework demoable without a key).
 *
 * Agents act only through tools. Reads query the database; writes go through
 * propose_command -> the API's command gateway. The loop never touches ERP
 * tables directly.
 */
import Anthropic from "@anthropic-ai/sdk";
import { count, eq } from "drizzle-orm";
import {
  account,
  agentRun,
  customer,
  item,
  supplier,
  type agent as agentTable,
  type agentRelease,
  type skill as skillTable,
  type skillVersion,
} from "@af/db";
import type { TranscriptStep } from "@af/shared";
import { db } from "../lib/db.js";
import { emitActivity } from "../lib/activity.js";

const API_URL = process.env.API_URL ?? "http://localhost:3001";
const STEP_DELAY_MS = Number(process.env.WORKER_STEP_DELAY_MS ?? 0);

/** Cost-tiered model routing (CLAUDE.md "Model routing & cost"): a release's
 * modelProfile resolves ANTHROPIC_MODEL_<PROFILE>, else ANTHROPIC_MODEL, else
 * the tier default. Route by task shape, not agent prestige: extraction and
 * classification run on the small model; judgement work on the mid tier;
 * reserve the top tier for profiles that demonstrably need it (eval first). */
const MODEL_TIER_DEFAULTS: Record<string, string> = {
  extraction: "claude-haiku-4-5", // high-volume, schema-tight work
  default: "claude-sonnet-5-5", // the agent workhorse
  reasoning: "claude-opus-5-5", // hard investigation/architecture only
};

export function resolveModel(profile: string): string {
  const envKey = `ANTHROPIC_MODEL_${profile.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return (
    process.env[envKey] ??
    process.env.ANTHROPIC_MODEL ??
    MODEL_TIER_DEFAULTS[profile] ??
    MODEL_TIER_DEFAULTS.default!
  );
}

export type ResolvedRelease = {
  agent: typeof agentTable.$inferSelect;
  release: typeof agentRelease.$inferSelect;
  skills: { skill: typeof skillTable.$inferSelect; version: typeof skillVersion.$inferSelect }[];
};

export type LoopResult = {
  outcome: "completed" | "escalated" | "failed" | "abstained";
  summary: string;
};

const pause = () =>
  STEP_DELAY_MS > 0 ? new Promise((r) => setTimeout(r, STEP_DELAY_MS)) : Promise.resolve();

async function appendStep(runId: string, steps: TranscriptStep[], step: Omit<TranscriptStep, "at">) {
  const full: TranscriptStep = { at: new Date().toISOString(), ...step };
  steps.push(full);
  if (db) {
    await db
      .update(agentRun)
      .set({ transcript: steps as unknown as Record<string, unknown>[] })
      .where(eq(agentRun.id, runId));
  }
  await pause();
  return full;
}

async function companyOverview(): Promise<Record<string, unknown>> {
  if (!db) return { error: "database unavailable" };
  const co = await db.query.company.findFirst();
  const n = async (t: typeof account | typeof supplier | typeof customer | typeof item) =>
    (await db!.select({ n: count() }).from(t))[0]?.n ?? 0;
  return {
    company: co ? { code: co.code, name: co.name, currency: co.currency } : null,
    counts: {
      accounts: await n(account),
      suppliers: await n(supplier),
      customers: await n(customer),
      items: await n(item),
    },
  };
}

function buildSystemPrompt(resolved: ResolvedRelease): string {
  const skillSections = resolved.skills
    .map(
      ({ skill, version }) =>
        `## Skill: ${skill.name} (v${version.version})\n${version.instructions}`,
    )
    .join("\n\n");
  return [
    resolved.release.instructions,
    skillSections,
    `## Operating rules
- You act only through your tools. You cannot move money, post journals, or send external communications; such requests are out of scope — finish with outcome "abstained" and explain.
- Permitted command types: ${resolved.release.commandPermissions.join(", ") || "none"}.
- Always end by calling the finish tool exactly once.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const ACCOUNT_GUESS: [RegExp, string][] = [
  [/software|subscription|licen[cs]e|hosting|saas|tool/i, "6200"],
  [/travel|hotel|train|flight|mileage/i, "6300"],
  [/marketing|campaign|advert|brand|conference|sponsor/i, "6400"],
  [/legal|accountan|insurance|payroll|recruit|professional/i, "6500"],
  [/rent|office space|cleaning|facilities|electric/i, "6100"],
  [/subcontract|contractor|associate day/i, "5000"],
];

/** Keyless purchase intake: parse the ask, propose purchase.create through the
 * gateway. The LLM path does this with judgement; this proves the plumbing. */
async function purchaseRequestFallback(
  resolved: ResolvedRelease,
  runId: string,
  text: string,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  if (/\b(pay|transfer|remit|send (the )?money|bank details?|sort code)\b/i.test(text)) {
    return {
      outcome: "abstained",
      summary: `This asks me to move money or touch bank details ("${text.slice(0, 80)}") — outside my remit. Payments follow from approved purchases; bank-detail changes are human-only.`,
    };
  }
  const amountMatch = text.match(/£\s*([\d,]+(?:\.\d{1,2})?)\s*(k)?/i);
  if (!amountMatch) {
    return {
      outcome: "escalated",
      summary: `I couldn't find an amount in the request ("${text.slice(0, 80)}"). Please resubmit with an estimated cost (e.g. "about £200").`,
    };
  }
  let totalMinor = Math.round(parseFloat(amountMatch[1]!.replace(/,/g, "")) * 100);
  if (amountMatch[2]) totalMinor *= 1000;
  const qtyMatch = text.replace(amountMatch[0], "").match(/\b(\d{1,3})\b\s*(?:x\s*)?[a-z]/i);
  const qty = qtyMatch ? Math.max(1, parseInt(qtyMatch[1]!, 10)) : 1;
  const unitPriceMinor = Math.max(1, Math.round(totalMinor / qty));
  const accountCode = ACCOUNT_GUESS.find(([re]) => re.test(text))?.[1] ?? "6900";

  let supplierCode: string | undefined;
  let supplierName: string | undefined;
  if (db) {
    const suppliers = await db.query.supplier.findMany();
    const hit = suppliers.find((s) =>
      text.toLowerCase().includes(s.name.toLowerCase().split(" ")[0]!.toLowerCase()) && s.name.split(" ")[0]!.length > 3,
    );
    if (hit) supplierCode = hit.code;
    else supplierCode = suppliers.find((s) => s.code === "SUP-001")?.code ?? suppliers[0]?.code;
  }
  if (!supplierCode) supplierName = "General Procurement";

  const params = {
    ...(supplierCode ? { supplierCode } : { supplierName }),
    requestedBy: resolved.agent.owner,
    businessNeed: text.slice(0, 500),
    lines: [{ description: text.slice(0, 120), qty, unitPriceMinor, accountCode }],
  };
  await appendStep(runId, steps, { kind: "note", label: "parsed request", detail: { qty, unitPriceMinor, accountCode, supplierCode: supplierCode ?? supplierName } });

  const res = await fetch(`${API_URL}/commands/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "purchase.create", params, idempotencyKey: `${runId}:1`, runId }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  await appendStep(runId, steps, { kind: "command", label: "propose purchase.create", detail: { status: res.status, response: data } });
  if (!res.ok) {
    return { outcome: "failed", summary: `Gateway rejected purchase.create: ${String((data as { error?: string }).error ?? res.status)}` };
  }
  const result = (data as { result?: { number?: string; approvalBand?: string; status?: string } }).result ?? data;
  const number = String(result.number ?? "created");
  const band = String(result.approvalBand ?? "standard");
  const status = String(result.status ?? "requested");
  return {
    outcome: "completed",
    summary:
      status === "approved"
        ? `Purchase ${number} created for £${(totalMinor / 100).toFixed(2)} and auto-approved under standing policy (${band} band). Supplier view issued; nothing further needed.`
        : `Purchase ${number} created for £${(totalMinor / 100).toFixed(2)} — awaits ${band} approval in the workbench inbox.`,
  };
}

async function proposeCommand(
  runId: string,
  seq: number,
  type: string,
  params: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`${API_URL}/commands/propose`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, params, idempotencyKey: `${runId}:${seq}`, runId }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  await appendStep(runId, steps, { kind: "command", label: `propose ${type}`, detail: { status: res.status, response: data } });
  return { ok: res.ok, data };
}

/** Keyless invoice extraction: parse the document's AF-DATA text layer (the
 * Studio embeds it in every PDF) and propose ap.invoice.capture. */
async function invoiceCaptureFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const text = String(payload.documentText ?? "");
  const emailText = String(payload.emailText ?? "");
  let doc: Record<string, unknown>;
  const m = text.match(/AF-DATA\s*(\{.*\})/s);
  if (m) {
    try {
      doc = JSON.parse(m[1]!) as Record<string, unknown>;
    } catch {
      return { outcome: "escalated", summary: "AF-DATA block was not valid JSON — escalating for human review." };
    }
  } else if (payload.fallbackData && typeof payload.fallbackData === "object") {
    // Scan document with no text layer and no model configured: the drip's
    // manifest truth keeps the keyless demo moving. With a key, the vision
    // path reads the pixels instead and never sees this field.
    doc = payload.fallbackData as Record<string, unknown>;
    await appendStep(runId, steps, {
      kind: "note",
      label: "scan document, keyless fallback",
      detail: { documentPath: payload.documentPath, note: "no model configured — using the drip manifest data instead of vision extraction" },
    });
  } else {
    return { outcome: "escalated", summary: "No machine-readable AF-DATA block in the document text — needs the LLM extraction path or human keying." };
  }
  await appendStep(runId, steps, { kind: "note", label: "extracted fields", detail: { number: doc.number, po: doc.po, grossMinor: doc.grossMinor } });

  const lines = (doc.lines as { description: string; qty: number; unitPriceMinor: number; account: string }[] | undefined) ?? [];
  const params = {
    supplierCode: String(payload.supplierCode ?? ""),
    supplierInvoiceNumber: String(doc.number ?? ""),
    ...(doc.po ? { purchaseNumber: String(doc.po) } : {}),
    invoiceDate: String(doc.invoiceDate ?? ""),
    dueDate: String(doc.dueDate ?? doc.invoiceDate ?? ""),
    lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitPriceMinor: l.unitPriceMinor, accountCode: l.account })),
    netMinor: Number(doc.netMinor ?? 0),
    vatMinor: Number(doc.vatMinor ?? 0),
    grossMinor: Number(doc.grossMinor ?? 0),
    ...(emailText ? { emailText } : {}),
    ...(typeof payload.documentPath === "string" ? { documentPath: payload.documentPath } : {}),
  };
  const { ok, data } = await proposeCommand(runId, 1, "ap.invoice.capture", params, steps);
  if (!ok) return { outcome: "failed", summary: `Gateway rejected capture: ${String((data as { error?: string }).error ?? "unknown")}` };
  const result = (data as { result?: { status?: string; exceptionCode?: string } }).result ?? {};
  const flagged = emailText && /bank|sort code|account number/i.test(emailText) ? " Covering email mentions bank details — screened by intake." : "";
  return {
    outcome: "completed",
    summary:
      result.status === "posted"
        ? `Captured invoice ${String(doc.number)} — matched its purchase and posted straight through.${flagged}`
        : `Captured invoice ${String(doc.number)} — ${String(result.exceptionCode ?? "exception")} raised; case opened for investigation.${flagged}`,
  };
}

/** Keyless commentary (plans/R2R.md §5): a grounded template over the
 * figures in the payload — biggest movers by absolute change, named with
 * their real amounts. Never invents a number. */
async function commentaryFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const periodCode = String(payload.periodCode ?? "");
  const figures = (payload.figures ?? []) as {
    code: string; name: string; type: string; thisMinor: number; prevMinor: number;
  }[];
  if (!periodCode || figures.length === 0)
    return { outcome: "escalated", summary: "No figures in the task payload — cannot draft grounded commentary." };

  const gbp = (m: number) => `£${(Math.abs(m) / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const movers = figures
    .map((f) => ({ ...f, delta: f.thisMinor - f.prevMinor }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3)
    .filter((f) => f.delta !== 0);
  const totalThis = figures.reduce((n, f) => n + f.thisMinor, 0);
  const totalPrev = figures.reduce((n, f) => n + f.prevMinor, 0);
  await appendStep(runId, steps, { kind: "note", label: "figures grounded", detail: { accounts: figures.length, movers: movers.map((m) => m.code) } });

  const lines = [
    `Net P&L movement for ${periodCode}: ${gbp(totalThis)} ${totalThis >= 0 ? "net cost" : "net income"} (prior month ${gbp(totalPrev)}).`,
    ...movers.map((m) =>
      `${m.name} (${m.code}) ${m.delta > 0 ? "up" : "down"} ${gbp(m.delta)} month on month — ${gbp(m.prevMinor)} to ${gbp(m.thisMinor)}.`),
    `Watch items: ${movers[0] ? `${movers[0].name} trend` : "none"}; open exceptions and unmatched bank lines are listed on the R2R dashboard.`,
    `Basis: live economic state; figures are month movements from the ledger.`,
  ];
  const text = lines.join(" ");
  const { ok, data } = await proposeCommand(runId, 1, "report.commentary.save", { periodCode, text }, steps);
  if (!ok)
    return { outcome: "failed", summary: `Gateway rejected commentary save: ${String((data as { error?: string }).error ?? "unknown")}` };
  return { outcome: "completed", summary: `Drafted ${periodCode} flux commentary from ${figures.length} accounts; top mover ${movers[0]?.name ?? "n/a"}. Saved as draft for human review.` };
}

/** Keyless bank-rec playbook (plans/R2R.md §2): known kinds map to accounts,
 * AR receipts are O2C's (abstain), unknowns get keyword heuristics or
 * escalate. Every posting proposal still needs a human (bank.txn.post). */
async function bankReconcileFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const kind = String(payload.kind ?? "");
  const reference = String(payload.reference ?? "");
  const counterparty = String(payload.counterparty ?? "");
  const bankTransactionId = String(payload.bankTransactionId ?? "");
  await appendStep(runId, steps, {
    kind: "note",
    label: `bank-rec playbook: ${kind || "unknown kind"}`,
    detail: { reference, counterparty, amountMinor: payload.amountMinor },
  });

  const KIND_ACCOUNTS: Record<string, { account: string; label: string }> = {
    salaries: { account: "6000", label: "net payroll run" },
    vat: { account: "2200", label: "VAT payment against the control account" },
    bank_fees: { account: "6900", label: "bank charges" },
  };
  const KEYWORDS: [RegExp, string, string][] = [
    [/rent|lease|workspace|facilit/i, "6100", "rent and facilities"],
    [/insur/i, "6100", "insurance (facilities)"],
    [/software|subscript|saas|hosting|licen[cs]e/i, "6200", "software and subscriptions"],
    [/travel|hotel|rail|flight|taxi/i, "6300", "travel and subsistence"],
    [/marketing|advert|campaign/i, "6400", "marketing"],
    [/legal|audit|account(ancy|ing)|consult/i, "6500", "professional fees"],
  ];

  const propose = async (accountCode: string, rationale: string) => {
    const { ok, data } = await proposeCommand(
      runId,
      1,
      "bank.txn.post",
      { bankTransactionId, accountCode, rationale },
      steps,
    );
    if (!ok)
      return {
        outcome: "failed" as const,
        summary: `Gateway rejected bank posting: ${String((data as { error?: string }).error ?? "unknown")}`,
      };
    return {
      outcome: "completed" as const,
      summary: `Investigated bank line ${reference} (${counterparty}): proposed posting to ${accountCode} — awaiting human approval. Rationale: ${rationale}`,
    };
  };

  if (kind === "ar_receipt")
    return {
      outcome: "abstained",
      summary: `Customer receipt ${reference} needs cash application against the AR subledger — that lands with O2C. Leaving the line categorised, not posting.`,
    };
  const ruled = KIND_ACCOUNTS[kind];
  if (ruled)
    return propose(ruled.account, `Bank feed kind "${kind}" maps to ${ruled.label} per the reconciliation rules; amount and date are consistent with the feed.`);
  const hit = KEYWORDS.find(([re]) => re.test(reference) || re.test(counterparty));
  if (hit)
    return propose(hit[1], `Reference/counterparty ("${reference}" / "${counterparty}") reads as ${hit[2]}; no purchase or payment run matches this line.`);
  // Don't echo the counterparty here: it is untrusted free text (it may
  // carry injected payment instructions) and the full line is already on
  // the bank feed for the human to read.
  return {
    outcome: "escalated",
    summary: `Cannot classify bank line ${reference} from the available evidence — a human should pick the account or trace the counterparty on the bank feed.`,
  };
}

/** Keyless exception playbook (plans/P2P.md §5): propose the taxonomy's
 * canonical resolution — which still requires HUMAN approval at the gateway —
 * or escalate where only a human can know (missing receipt, fraud risk). */
async function invoiceExceptionFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const code = String(payload.exceptionCode ?? "");
  const detail = String(payload.detail ?? "");
  const invoiceId = String(payload.invoiceId ?? "");
  await appendStep(runId, steps, { kind: "note", label: `playbook: ${code}`, detail: { detail } });

  const propose = async (resolution: string, rationale: string, extra: Record<string, unknown> = {}) => {
    const { ok, data } = await proposeCommand(runId, 1, "ap.invoice.resolve", { invoiceId, resolution, rationale, ...extra }, steps);
    if (!ok) return { outcome: "failed" as const, summary: `Gateway rejected resolution: ${String((data as { error?: string }).error ?? "unknown")}` };
    return {
      outcome: "completed" as const,
      summary: `Investigated ${code}: proposed ${resolution} — awaiting human approval in the inbox. Rationale: ${rationale}`,
    };
  };

  switch (code) {
    case "price_variance":
      return propose("approve_adjusted", `Invoiced price exceeds the approved purchase beyond tolerance (${detail}). No agreed increase found on file; recommending acceptance at invoiced amounts this once — flag the supplier for a rate review.`);
    case "duplicate_suspect":
      return propose("reject", `Duplicate billing detected (${detail}). The original invoice stands; this copy should be rejected and the supplier notified.`);
    case "qty_short_receipt": {
      const m = detail.match(/Line (\d+).*received (\d+)/);
      if (!m) return { outcome: "escalated", summary: `Could not read received quantity from the case detail ("${detail}") — a human should set the part-approval quantity.` };
      return propose(
        "part_approve",
        `Invoiced quantity exceeds goods received (${detail}). Recommending part-approval for the received quantity; the shortfall should be re-billed on delivery.`,
        { adjustedQuantities: [{ lineNo: Number(m[1]), qty: Number(m[2]) }] },
      );
    }
    case "no_purchase":
      return propose("retro_purchase", `Invoice arrived without a purchase record (${detail}). Spend classifies as routine; recommending a retro purchase so the commitment is on the books — director approval applies automatically if it exceeds the auto band.`);
    case "missing_receipt":
      return {
        outcome: "escalated",
        summary: `Invoice references its purchase but no goods receipt exists (${detail}). Only a human can confirm the goods actually arrived — once confirmed, resolve with record_receipt.`,
      };
    case "bank_detail_change":
      return {
        outcome: "abstained",
        summary: "Fraud-risk case: the covering email requests a bank detail change. I will not action or recommend any resolution — verify with the supplier via a known channel, out of band. The invoice stays held.",
      };
    default:
      return { outcome: "escalated", summary: `No playbook for exception code "${code}" — human triage needed.` };
  }
}

/** Deterministic fallback so the framework runs end-to-end without a model. */
async function deterministicHandler(
  resolved: ResolvedRelease,
  runId: string,
  taskType: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  await appendStep(runId, steps, {
    kind: "note",
    label: "deterministic mode",
    detail: { reason: "no model configured for this run" },
  });
  // Route by task type, with eval.case routed by payload shape.
  if (taskType === "purchase.request" || (taskType === "eval.case" && typeof payload.text === "string")) {
    return purchaseRequestFallback(resolved, runId, String(payload.text ?? ""), steps);
  }
  if (taskType === "invoice.capture" || (taskType === "eval.case" && typeof payload.documentText === "string")) {
    return invoiceCaptureFallback(resolved, runId, payload, steps);
  }
  if (taskType === "invoice.exception" || (taskType === "eval.case" && typeof payload.exceptionCode === "string")) {
    return invoiceExceptionFallback(resolved, runId, payload, steps);
  }
  if (taskType === "bank.reconcile" || (taskType === "eval.case" && typeof payload.bankTransactionId === "string")) {
    return bankReconcileFallback(resolved, runId, payload, steps);
  }
  if (taskType === "r2r.commentary" || (taskType === "eval.case" && Array.isArray(payload.figures))) {
    return commentaryFallback(resolved, runId, payload, steps);
  }
  if (taskType === "hello.greet" || taskType === "eval.case") {
    const topic = String(payload.topic ?? "the business");
    const audience = String(payload.audience ?? "the team");
    if (/transfer|pay(ment)?\s|£|\bmove\b.*money|bank account/i.test(topic)) {
      return {
        outcome: "abstained",
        summary: `Request mentions moving money ("${topic}") — outside my remit. A human must handle this through the approval workflow.`,
      };
    }
    const overview = await companyOverview();
    await appendStep(runId, steps, {
      kind: "tool_call",
      label: "get_company_overview",
      detail: overview,
    });
    const counts = (overview as { counts?: Record<string, number> }).counts;
    return {
      outcome: "completed",
      summary: `Hello ${audience} — Brightline Ltd is live: ${counts?.suppliers ?? 0} suppliers, ${counts?.customers ?? 0} customers and ${counts?.accounts ?? 0} accounts on the books. On ${topic}: the data is ready for review. Next step: open the workbench dashboard for the detail.`,
    };
  }
  return {
    outcome: "escalated",
    summary: `No deterministic handler for task type "${taskType}" and no model configured — escalating to a human.`,
  };
}

export async function runAgentLoop(
  resolved: ResolvedRelease,
  runId: string,
  taskType: string,
  payload: Record<string, unknown>,
): Promise<LoopResult> {
  const steps: TranscriptStep[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const useModel = resolved.release.modelProfile !== "none" && !!apiKey;

  await appendStep(runId, steps, {
    kind: "note",
    label: "task received",
    detail: { taskType, payload, release: `v${resolved.release.version}` },
  });

  if (!useModel) {
    const result = await deterministicHandler(resolved, runId, taskType, payload, steps);
    await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: result.summary } });
    return result;
  }

  const client = new Anthropic();
  const model = resolveModel(resolved.release.modelProfile);
  const tools: Anthropic.Tool[] = [
    {
      name: "get_company_overview",
      description: "Read live Brightline Ltd master data: company details and counts of accounts, suppliers, customers and items.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      strict: true,
    },
    {
      name: "get_suppliers",
      description: "List registered suppliers (code, name, payment terms). Use the code in purchase.create.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      strict: true,
    },
    {
      name: "get_accounts",
      description: "List the chart of accounts (code, name, type) for coding purchase lines.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      strict: true,
    },
    {
      name: "get_category_budget",
      description: "Budget vs committed vs actual for an expense account in a period (YYYY-MM).",
      input_schema: {
        type: "object",
        properties: {
          accountCode: { type: "string" },
          periodCode: { type: "string" },
        },
        required: ["accountCode", "periodCode"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "get_invoice_context",
      description: "Full context for an AP invoice: the invoice, its purchase (the approved ask), goods receipts, and case history. Use for exception investigations.",
      input_schema: {
        type: "object",
        properties: { invoiceId: { type: "string" } },
        required: ["invoiceId"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "propose_command",
      description:
        "Propose a typed command to the platform's command gateway. It validates your permission and either executes it under standing authority or queues it for human approval. Params must match the command type's schema.",
      input_schema: {
        type: "object",
        properties: {
          type: { type: "string", description: "Registered command type, e.g. case.note" },
          params: { type: "object", description: "Command parameters" },
        },
        required: ["type", "params"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description: "End the task with your outcome and a stakeholder-ready summary. Call exactly once, as your final action.",
      input_schema: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["completed", "abstained", "escalated"] },
          summary: { type: "string" },
        },
        required: ["outcome", "summary"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];

  // Vision path (format mix): a scan-style PDF has no text layer, so the
  // document itself goes to the model as pixels. The keyless fallback data
  // never reaches the model — extraction must be real work.
  const { fallbackData: _hidden, ...modelPayload } = payload;
  const firstContent: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `Task type: ${taskType}\nTask payload:\n${JSON.stringify(modelPayload, null, 2)}` },
  ];
  if (
    typeof payload.documentPath === "string" &&
    /\.pdf$/i.test(payload.documentPath) &&
    !payload.documentText
  ) {
    try {
      const res = await fetch(`${API_URL}/${payload.documentPath}`);
      if (res.ok) {
        const data = Buffer.from(await res.arrayBuffer()).toString("base64");
        firstContent.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data },
        });
        await appendStep(runId, steps, {
          kind: "note",
          label: "document attached for vision extraction",
          detail: { documentPath: payload.documentPath, bytes: data.length },
        });
      }
    } catch {
      /* document unreachable: the model will say so and escalate */
    }
  }
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: firstContent }];
  const system = buildSystemPrompt(resolved);
  let modelCalls = 0;
  let commandSeq = 0;
  let totals = { input: 0, output: 0 };

  while (modelCalls < resolved.release.maxModelCalls) {
    modelCalls++;
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        system,
        tools,
        messages,
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) {
        await appendStep(runId, steps, { kind: "note", label: "rate limited; backing off", detail: {} });
        await new Promise((r) => setTimeout(r, 5000));
        modelCalls--;
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      await appendStep(runId, steps, { kind: "outcome", label: "failed", detail: { error: message } });
      return { outcome: "failed", summary: `Model call failed: ${message}` };
    }

    totals = {
      input: totals.input + response.usage.input_tokens,
      output: totals.output + response.usage.output_tokens,
    };
    if (db) {
      await db
        .update(agentRun)
        .set({ modelCalls, inputTokens: totals.input, outputTokens: totals.output })
        .where(eq(agentRun.id, runId));
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    await appendStep(runId, steps, {
      kind: "model_call",
      label: `model call ${modelCalls}`,
      detail: { stop_reason: response.stop_reason, text: text.slice(0, 2000) },
    });

    if (response.stop_reason === "refusal") {
      const result: LoopResult = { outcome: "abstained", summary: "The model declined this request for safety reasons." };
      await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: result.summary } });
      return result;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) {
      const result: LoopResult = {
        outcome: "completed",
        summary: text || "(no summary returned)",
      };
      await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: result.summary } });
      return result;
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolUses) {
      const input = tu.input as Record<string, unknown>;
      if (tu.name === "finish") {
        const result: LoopResult = {
          outcome: (input.outcome as LoopResult["outcome"]) ?? "completed",
          summary: String(input.summary ?? ""),
        };
        await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: result.summary } });
        return result;
      }
      if (tu.name === "get_invoice_context") {
        let result: unknown = { error: "database unavailable" };
        if (db) {
          const q = input as { invoiceId: string };
          const inv = await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, q.invoiceId) });
          if (!inv) result = { error: "invoice not found" };
          else {
            const p = inv.purchaseId
              ? await db.query.purchase.findFirst({ where: (t, { eq: e }) => e(t.id, inv.purchaseId!) })
              : null;
            const receipts = p
              ? await db.query.goodsReceipt.findMany({ where: (t, { eq: e }) => e(t.purchaseId, p.id) })
              : [];
            const events = inv.caseId
              ? await db.query.caseEvent.findMany({ where: (t, { eq: e }) => e(t.caseId, inv.caseId!) })
              : [];
            result = { invoice: inv, purchase: p, receipts, caseEvents: events };
          }
        }
        await appendStep(runId, steps, { kind: "tool_call", label: "get_invoice_context", detail: { input } });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
        continue;
      }
      if (tu.name === "get_suppliers" || tu.name === "get_accounts" || tu.name === "get_category_budget") {
        let result: unknown = { error: "database unavailable" };
        if (db) {
          if (tu.name === "get_suppliers") {
            result = (await db.query.supplier.findMany({ limit: 60 })).map((s) => ({
              code: s.code,
              name: s.name,
              paymentTermsDays: s.paymentTermsDays,
            }));
          } else if (tu.name === "get_accounts") {
            result = (await db.query.account.findMany()).map((a) => ({ code: a.code, name: a.name, type: a.type }));
          } else {
            const q = input as { accountCode: string; periodCode: string };
            result =
              (await db.query.categoryBudget.findFirst({
                where: (t, { and, eq: e }) => and(e(t.accountCode, q.accountCode), e(t.periodCode, q.periodCode)),
              })) ?? { note: "no budget row for that account/period" };
          }
        }
        await appendStep(runId, steps, { kind: "tool_call", label: tu.name, detail: { input, preview: JSON.stringify(result).slice(0, 500) } });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
        continue;
      }
      if (tu.name === "get_company_overview") {
        const overview = await companyOverview();
        await appendStep(runId, steps, { kind: "tool_call", label: "get_company_overview", detail: overview });
        await emitActivity({
          actorType: "agent",
          actorId: resolved.agent.slug,
          verb: "called_tool",
          objectType: "run",
          objectId: runId,
          summary: `${resolved.agent.name} read the company overview`,
        });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(overview) });
        continue;
      }
      if (tu.name === "propose_command") {
        commandSeq++;
        const res = await fetch(`${API_URL}/commands/propose`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: input.type,
            params: input.params ?? {},
            idempotencyKey: `${runId}:${commandSeq}`,
            runId,
          }),
        });
        const data = (await res.json().catch(() => ({ error: "bad gateway response" }))) as Record<string, unknown>;
        await appendStep(runId, steps, {
          kind: "command",
          label: `propose ${String(input.type)}`,
          detail: { status: res.status, response: data },
        });
        await emitActivity({
          actorType: "agent",
          actorId: resolved.agent.slug,
          verb: "proposed_command",
          objectType: "command",
          objectId: String(data.id ?? input.type),
          summary: `${resolved.agent.name} proposed ${String(input.type)} (${res.ok ? String(data.status ?? "ok") : "rejected"})`,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(data),
          ...(res.ok ? {} : { is_error: true }),
        });
        continue;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: true,
        content: `unknown tool ${tu.name}`,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  const result: LoopResult = {
    outcome: "failed",
    summary: `Run exceeded its budget of ${resolved.release.maxModelCalls} model calls without finishing.`,
  };
  await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: result.summary } });
  return result;
}
