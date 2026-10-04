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
import { getActiveTemplate, recordHit, recordLearning, recordMiss } from "./templates.js";

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

function buildSystemPrompt(resolved: ResolvedRelease, taskType?: string): string {
  const skillSections = resolved.skills
    .map(
      ({ skill, version }) =>
        `## Skill: ${skill.name} (v${version.version})\n${version.instructions}`,
    )
    .join("\n\n");
  // Chat-built boards (plans/DATASET_V2.md PR-E): the Analyst PROPOSES a
  // board; a human clicks Create in the panel. Worker-side rule (not skill
  // text) so it applies to every analyst release immediately.
  const boardRule =
    taskType === "analyst.question" || taskType === "eval.case"
      ? `
- Building pages: when asked to build/create a page, board or dashboard from described tiles, design it from the CURATED VIEWS ONLY (pl-trend, flux, aging, counterparty, cash — with their documented params) and end your summary, after the sources line, with ONE line exactly of the form: board: {"slug":"...","title":"...","description":"...","tiles":[{"view":"...","params":{...},"title":"...","span":1|2}]}. The person confirms creation with one click — you never create the page yourself. If a described tile cannot be served by a curated view, leave it out and say so.`
      : "";
  return [
    resolved.release.instructions,
    skillSections,
    `## Operating rules
- You act only through your tools. You cannot move money, post journals, or send external communications; such requests are out of scope — finish with outcome "abstained" and explain.
- Your tool list is the authoritative statement of your capabilities: where a skill's text names fewer or older tools, the tools actually offered here supersede it.
- Permitted command types: ${resolved.release.commandPermissions.join(", ") || "none"}.${boardRule}
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

  const res = await apiFetch(`/commands/propose`, {
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


/** Worker→API fetch with retries: a mid-deploy API restart must not kill a
 * run (command proposals are idempotent by key, so retrying is safe). */
async function apiFetch(path: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(`${API_URL}${path}`, init);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`API unreachable after ${attempts} attempts (${String(lastErr)}) — the platform API may be restarting; the task can be retried`);
}

async function proposeCommand(
  runId: string,
  seq: number,
  type: string,
  params: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await apiFetch(`/commands/propose`, {
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
    ...(doc.iban ? { ibanOnInvoice: String(doc.iban) } : {}),
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

/** Keyless cash application (plans/O2C.md §4): exact amount + unique
 * candidate → propose; reference contained in a candidate number → propose;
 * else escalate. Every application needs a human (ar.receipt.apply). */
async function cashApplicationFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const bankTransactionId = String(payload.bankTransactionId ?? "");
  const reference = String(payload.reference ?? "");
  const amountMinor = Number(payload.amountMinor ?? 0);
  const candidates = (payload.candidates ?? []) as {
    invoiceId: string; number: string; grossMinor: number; customerName: string;
  }[];
  await appendStep(runId, steps, {
    kind: "note",
    label: "cash application",
    detail: { reference, amountMinor, candidates: candidates.map((c) => c.number) },
  });

  const propose = async (c: (typeof candidates)[number], why: string) => {
    const rationale = `Receipt "${reference}" for ${amountMinor} matches invoice ${c.number} (${c.customerName}, ${c.grossMinor}): ${why}`;
    const { ok, data } = await proposeCommand(
      runId, 1, "ar.receipt.apply",
      { bankTransactionId, invoiceId: c.invoiceId, rationale }, steps,
    );
    if (!ok)
      return { outcome: "failed" as const, summary: `Gateway rejected application: ${String((data as { error?: string }).error ?? "unknown")}` };
    return { outcome: "completed" as const, summary: `Proposed applying receipt to ${c.number} — awaiting human approval. ${why}` };
  };

  const amountHits = candidates.filter((c) => c.grossMinor === amountMinor);
  if (amountHits.length === 1) return propose(amountHits[0]!, "exact amount, single open invoice at that value.");
  const refHit = candidates.find((c) => reference.includes(c.number) || c.number.includes(reference));
  if (refHit && refHit.grossMinor === amountMinor)
    return propose(refHit, "reference cites the invoice number and the amount agrees.");
  if (amountHits.length > 1)
    return {
      outcome: "escalated",
      summary: `${amountHits.length} open invoices share this amount (${amountHits.map((c) => c.number).join(", ")}) and the reference decides nothing — a human should pick, or request a remittance advice.`,
    };
  return {
    outcome: "escalated",
    summary: `No open invoice matches receipt amount ${amountMinor} — possible part-payment or unknown payer; a human should investigate.`,
  };
}

/** Keyless collections letter (plans/O2C.md §5): firm, courteous, grounded
 * in the payload facts only. Sending always needs a human. */
async function collectionsFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const invoiceId = String(payload.invoiceId ?? "");
  const number = String(payload.number ?? "");
  const customerName = String(payload.customerName ?? "");
  const grossMinor = Number(payload.grossMinor ?? 0);
  const dueDate = String(payload.dueDate ?? "");
  const daysOverdue = Number(payload.daysOverdue ?? 0);
  if (!invoiceId || !number || grossMinor <= 0)
    return { outcome: "escalated", summary: "Missing invoice facts in the task payload — cannot draft a grounded letter." };
  const gbp = `£${(grossMinor / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  await appendStep(runId, steps, { kind: "note", label: "drafting dunning letter", detail: { number, daysOverdue } });

  const text = [
    `Dear ${customerName},`,
    `Our records show invoice ${number} for ${gbp}, due on ${dueDate}, remains unpaid (${daysOverdue} days overdue).`,
    `If payment has already been made, please share the remittance details so we can apply it promptly. Otherwise we would appreciate settlement within 7 days.`,
    `If anything is blocking payment — a query on the invoice, or a copy needed — reply to this message and we will resolve it quickly.`,
    `Kind regards,\nAccounts Receivable, Brightline Ltd`,
  ].join("\n\n");

  const { ok, data } = await proposeCommand(runId, 1, "ar.dunning.send", { invoiceId, text }, steps);
  if (!ok)
    return { outcome: "failed", summary: `Gateway rejected dunning: ${String((data as { error?: string }).error ?? "unknown")}` };
  return {
    outcome: "completed",
    summary: `Drafted a chase letter for ${number} (${customerName}, ${gbp}, ${daysOverdue} days overdue) — awaiting human approval before anything is sent.`,
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
  const caseId = typeof payload.caseId === "string" ? payload.caseId : null;
  await appendStep(runId, steps, { kind: "note", label: `playbook: ${code}`, detail: { detail } });

  // Ground the options in the actual records (plans/P2P.md §10): the approved
  // purchase, what was received, what was invoiced — so every option is
  // specific and costed, never generic.
  type Opt = {
    resolution: string;
    label: string;
    rationale: string;
    costedNote?: string;
    adjustedQuantities?: { lineNo: number; qty: number }[];
  };
  const gbp = (m: number) => `£${(Math.abs(m) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  let inv: { lines: { lineNo: number; qty: number; unitPriceMinor: number; description: string }[]; grossMinor: number; purchaseId: string | null } | null = null;
  let po: { lines: { lineNo: number; qty: number; unitPriceMinor: number }[]; totalMinor: number } | null = null;
  let receivedBy: Map<number, number> | null = null;
  if (db && invoiceId) {
    const row = await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, invoiceId) });
    if (row) {
      inv = { lines: row.lines, grossMinor: row.grossMinor, purchaseId: row.purchaseId };
      if (row.purchaseId) {
        const p = await db.query.purchase.findFirst({ where: (t, { eq: e }) => e(t.id, row.purchaseId!) });
        if (p) po = { lines: p.lines, totalMinor: p.totalMinor };
        const grns = await db.query.goodsReceipt.findMany({ where: (t, { eq: e }) => e(t.purchaseId, row.purchaseId!) });
        receivedBy = new Map();
        for (const g of grns) for (const q of g.quantities) receivedBy.set(q.lineNo, (receivedBy.get(q.lineNo) ?? 0) + q.qtyReceived);
      }
    }
  }
  const varianceMinor =
    inv && po
      ? inv.lines.reduce((s, l) => {
          const pl = po!.lines.find((x) => x.lineNo === l.lineNo);
          return s + (pl ? l.qty * l.unitPriceMinor - pl.qty * pl.unitPriceMinor : l.qty * l.unitPriceMinor);
        }, 0)
      : null;

  const options: Opt[] = [];
  if (code === "price_variance") {
    options.push(
      {
        resolution: "approve_adjusted",
        label: `Accept the variance and post at invoiced amounts`,
        rationale: `Invoiced price exceeds the approved purchase${varianceMinor !== null ? ` by ${gbp(varianceMinor)} net` : ""} (${detail}). No agreed increase on file; accepting this once and flagging the supplier for a rate review.`,
        costedNote: varianceMinor !== null ? `costs ${gbp(varianceMinor)} more than approved` : undefined,
      },
      {
        resolution: "reject",
        label: "Reject and ask the supplier to re-bill at the agreed price",
        rationale: `The purchase was approved at a lower price (${detail}); the supplier should re-issue at the agreed rate.`,
        costedNote: varianceMinor !== null ? `saves ${gbp(varianceMinor)}, delays settlement` : undefined,
      },
    );
  } else if (code === "qty_short_receipt") {
    const adjusted =
      inv && receivedBy
        ? inv.lines.map((l) => ({ lineNo: l.lineNo, qty: Math.min(l.qty, receivedBy!.get(l.lineNo) ?? l.qty) }))
        : undefined;
    const partGross =
      inv && adjusted
        ? Math.round(adjusted.reduce((s, a) => s + a.qty * (inv!.lines.find((l) => l.lineNo === a.lineNo)?.unitPriceMinor ?? 0), 0) * 1.2)
        : null;
    options.push(
      {
        resolution: "part_approve",
        label: "Pay for the quantities received",
        rationale: `Invoiced quantity exceeds goods received (${detail}). Part-approve for the received quantities; the shortfall re-bills on delivery.`,
        costedNote: partGross !== null && inv ? `pays ${gbp(partGross)} of ${gbp(inv.grossMinor)}` : undefined,
        adjustedQuantities: adjusted,
      },
      {
        resolution: "record_receipt",
        label: "Goods confirmed received — record the receipt and pay in full",
        rationale: `If ops confirm the delivery landed but was never booked, record the receipt and the invoice matches (${detail}).`,
        costedNote: inv ? `pays ${gbp(inv.grossMinor)} in full` : undefined,
      },
      { resolution: "reject", label: "Reject — dispute the billed quantity", rationale: `The supplier billed more than was delivered (${detail}) and no delivery is expected.` },
    );
  } else if (code === "missing_receipt") {
    options.push(
      {
        resolution: "record_receipt",
        label: "Goods confirmed received — record the receipt and post",
        rationale: `The purchase exists but no goods receipt was booked (${detail}). Once a human confirms arrival, record it and the 3-way match completes.`,
        costedNote: inv ? `pays ${gbp(inv.grossMinor)}` : undefined,
      },
      { resolution: "reject", label: "No goods received — reject the invoice", rationale: `No goods receipt and no confirmation of delivery (${detail}).` },
    );
  } else if (code === "no_purchase") {
    options.push(
      {
        resolution: "retro_purchase",
        label: "Raise a retro purchase to put the commitment on the books",
        rationale: `Invoice arrived without a purchase record (${detail}). A retro purchase restores the control trail; band approval applies automatically.`,
        costedNote: inv ? `commits ${gbp(inv.grossMinor)}` : undefined,
      },
      { resolution: "reject", label: "Unapproved spend — reject", rationale: `No purchase record and no approver on file (${detail}).` },
    );
  } else if (code === "duplicate_suspect") {
    options.push(
      {
        resolution: "reject",
        label: "Reject as a duplicate",
        rationale: `Duplicate billing detected (${detail}). The original invoice stands; notify the supplier.`,
        costedNote: inv ? `avoids paying ${gbp(inv.grossMinor)} twice` : undefined,
      },
      { resolution: "approve_adjusted", label: "Confirmed as a separate charge — post at invoiced amounts", rationale: `If review shows this is a genuinely separate charge (${detail}), post at invoiced amounts.` },
    );
  } else if (code === "bank_detail_change") {
    options.push({
      resolution: "human_verify",
      label: "Verify with the supplier out of band — never from this email",
      rationale: `The covering email requests a bank detail change (${detail}). Call the supplier on the number already on file; if genuine, update details through master data, then release. If not, reject and report.`,
    });
  } else if (code === "bank_detail_mismatch") {
    options.push({
      resolution: "human_verify",
      label: "Verify the bank details out of band — never from the document",
      rationale: `The IBAN printed on the invoice differs from the supplier master's verified bank details (${detail}). Confirm the correct account with the supplier via a channel already on file; if the master is stale, update it through master data and re-capture. If not, reject and report.`,
    });
  } else if (code === "total_mismatch") {
    options.push(
      {
        resolution: "reject",
        label: "Reject for a corrected invoice",
        rationale: `The stated grand total does not equal the sum of the lines (${detail}). If the document itself is wrong, the supplier should re-bill correctly.`,
      },
      {
        resolution: "part_approve",
        label: "Lines verified right — approve at the line sum",
        rationale: `If a page-by-page re-check confirms every line and only the stated total is wrong, part-approve at the invoiced quantities so the posting equals the verified line sum (${detail}). Never approve at the stated total.`,
        adjustedQuantities: inv?.lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty })),
      },
    );
  }

  if (caseId && options.length > 0) {
    await proposeCommand(runId, 1, "case.options", { caseId, options }, steps);
  }

  const propose = async (resolution: string, rationale: string, extra: Record<string, unknown> = {}) => {
    const { ok, data } = await proposeCommand(runId, 2, "ap.invoice.resolve", { invoiceId, resolution, rationale, ...extra }, steps);
    if (!ok) return { outcome: "failed" as const, summary: `Gateway rejected resolution: ${String((data as { error?: string }).error ?? "unknown")}` };
    return {
      outcome: "completed" as const,
      summary: `Investigated ${code}: ${options.length} grounded options on the case; recommended ${resolution} — awaiting human approval. Rationale: ${rationale}`,
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
        summary: `Invoice references its purchase but no goods receipt exists (${detail}). Only a human can confirm the goods actually arrived — both options are on the case in the exceptions workbench.`,
      };
    case "bank_detail_change":
      return {
        outcome: "abstained",
        summary: "Fraud-risk case: the covering email requests a bank detail change. I will not action or recommend any resolution — verify with the supplier via a known channel, out of band (guidance is on the case). The invoice stays held.",
      };
    case "bank_detail_mismatch":
      return {
        outcome: "abstained",
        summary: `Fraud-risk case: the IBAN printed on the invoice differs from the supplier master's verified bank details (${detail}). I will not action or recommend any resolution — confirm the correct account with the supplier via a known channel, out of band. The invoice stays held; nothing is paid until the master and the document agree.`,
      };
    case "total_mismatch":
      return {
        outcome: "escalated",
        summary: `The invoice's stated total does not equal the sum of its lines (${detail}) — typical of a multi-page carried-subtotal error or a bad extraction. A human should re-check every page against the lines, then either reject for a corrected invoice or part-approve at the verified line quantities.`,
      };
    default:
      return { outcome: "escalated", summary: `No playbook for exception code "${code}" — human triage needed.` };
  }
}

/** The Analyst's entire data surface (plans/ANALYTICS.md M2): the curated
 * view endpoints, by id. Grounded by construction — there is no SQL tool and
 * no table access, so the model can only read what the catalogue serves. */
const ANALYST_VIEWS: Record<string, { path: string; params: string[] }> = {
  "pl-trend": { path: "/analytics/pl-trend", params: ["year", "from", "to"] },
  flux: { path: "/analytics/flux", params: ["period", "from", "to"] },
  aging: { path: "/analytics/aging", params: ["side", "asOf"] },
  counterparty: { path: "/analytics/counterparty", params: ["dim", "from", "to"] },
  cash: { path: "/analytics/cash", params: ["from", "to"] },
};

async function runView(viewId: string, params: Record<string, unknown>): Promise<unknown> {
  const view = ANALYST_VIEWS[viewId];
  if (!view) return { error: `unknown view "${viewId}" — valid ids: ${Object.keys(ANALYST_VIEWS).join(", ")}` };
  const qs = new URLSearchParams();
  for (const k of view.params) {
    const v = params?.[k];
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const res = await apiFetch(`${view.path}${qs.size ? `?${qs}` : ""}`, { method: "GET" });
  return res.json().catch(() => ({ error: `view returned non-JSON (status ${res.status})` }));
}

const sumBuckets = (b: number[]) => b.slice(1).reduce((x, y) => x + y, 0);
const gbpMinor = (m: number) =>
  `£${(Math.abs(m) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

/** Keyless analyst (plans/ANALYTICS.md M2): a few question shapes answer
 * deterministically from the curated views, with the same sources line the
 * model path produces. Anything else is answered honestly — free-text
 * analysis needs a model key; nothing is ever invented. */
async function analystFallback(
  resolved: ResolvedRelease,
  runId: string,
  payload: Record<string, unknown>,
  steps: TranscriptStep[],
): Promise<LoopResult> {
  const q = String(payload.question ?? "");
  const note = async (label: string, detail: Record<string, unknown>) =>
    appendStep(runId, steps, { kind: "tool_call", label, detail });

  if (/\bforecast|predict|project(ion)?|next (quarter|year|month)|budget for\b/i.test(q))
    return {
      outcome: "escalated",
      summary:
        "I can't answer that from governed data: the curated views hold actuals only — there is no forward view, and I don't extrapolate. The closest available evidence is the pl-trend view (monthly actuals by account) at /analytics.\n\nsources: views catalogue",
    };

  // Chat-built boards (plans/DATASET_V2.md PR-E), keyless path: recognise a
  // build-a-page ask, map the described tiles onto the curated views, and
  // PROPOSE the board as a `board:` line — the person confirms with a click.
  if (/\b(build|create|make|compose|set up)\b[\s\S]*\b(page|board|dashboard)\b/i.test(q)) {
    type Tile = { view: string; params?: Record<string, string>; title?: string; span?: 1 | 2 };
    const tiles: Tile[] = [];
    if (/cash|bank balance/i.test(q)) tiles.push({ view: "cash", title: "Cash position", span: 2 });
    if (/\b(ap|supplier|payab|we owe)\b[\s\S]{0,30}(aging|ageing|overdue)|aging[\s\S]{0,20}\b(ap|supplier)/i.test(q))
      tiles.push({ view: "aging", params: { side: "ap" }, title: "AP aging" });
    if (/\b(ar|customer|receivab|owes? us|debtor)\b[\s\S]{0,30}(aging|ageing|overdue)|aging[\s\S]{0,20}\b(ar|customer)/i.test(q))
      tiles.push({ view: "aging", params: { side: "ar" }, title: "AR aging" });
    if (/flux|variance|waterfall|why.*moved?/i.test(q)) tiles.push({ view: "flux", title: "Month flux" });
    if (/trend|p&l|profit|monthly movement/i.test(q)) tiles.push({ view: "pl-trend", title: "P&L trend", span: 2 });
    if (/supplier spend|spend by supplier|top suppliers/i.test(q))
      tiles.push({ view: "counterparty", params: { dim: "supplier" }, title: "Spend by supplier" });
    if (/customer revenue|revenue by customer|top customers/i.test(q))
      tiles.push({ view: "counterparty", params: { dim: "customer" }, title: "Revenue by customer" });
    if (/\b(aging|ageing|overdue)\b/i.test(q) && !tiles.some((t) => t.view === "aging"))
      tiles.push({ view: "aging", params: { side: "ap" }, title: "AP aging" }, { view: "aging", params: { side: "ar" }, title: "AR aging" });
    if (tiles.length === 0)
      return {
        outcome: "escalated",
        summary:
          "I can only compose pages from the curated views (P&L trend, month flux, AP/AR aging, supplier/customer concentration, cash) — I couldn't match the tiles you described to any of them. Name the views you want and I'll lay the page out.\n\nsources: views catalogue",
      };
    // the name ends where the tile description begins ("… called Cash focus
    // with the cash position and AP aging" → "Cash focus")
    const nameMatch = q.match(/\b(?:called|named|titled)\s+["']?(.+?)["']?(?=\s+(?:with|showing|that|containing|including|for)\b|[.!?]|$)/i);
    const title = (nameMatch?.[1] ?? "Custom board").trim().slice(0, 60);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50) || "custom-board";
    const board = { slug, title, description: `Composed from: ${q.slice(0, 140)}`, tiles };
    await note("compose board (keyless)", { slug, tiles: tiles.map((t) => t.view) });
    return {
      outcome: "completed",
      summary: `Here's the page I'd build — ${tiles.length} tile${tiles.length === 1 ? "" : "s"}, every one a governed view (${[...new Set(tiles.map((t) => t.view))].join(", ")}). Confirm below and it appears at /analytics/boards/${slug}.\n\nsources: views catalogue\nboard: ${JSON.stringify(board)}`,
    };
  }

  if (/\boverdue|owes? us|debtors?|chas(e|ing)|aging|ageing\b/i.test(q) && !/\bowe\b.*supplier|supplier.*overdue|creditors/i.test(q)) {
    const a = (await runView("aging", { side: "ar" })) as {
      asOf: string; overdueMinor: number; totalMinor: number;
      parties: { name: string; buckets: number[]; totalMinor: number; items: number }[];
    };
    await note("run_view aging", { side: "ar", parties: a.parties?.length });
    const top = [...(a.parties ?? [])].sort((x, y) => sumBuckets(y.buckets) - sumBuckets(x.buckets))[0];
    if (!top) return { outcome: "completed", summary: "Nothing is open on the AR ledger — no customer is overdue.\n\nsources: aging (side=ar)" };
    return {
      outcome: "completed",
      summary: `${top.name} is the most overdue customer: ${gbpMinor(sumBuckets(top.buckets))} past due of ${gbpMinor(top.totalMinor)} open (${top.items} invoices), at ${a.asOf}. Across all customers ${gbpMinor(a.overdueMinor)} of ${gbpMinor(a.totalMinor)} open is past due. Charts and the full list: /analytics.\n\nsources: aging (side=ar, asOf=${a.asOf})`,
    };
  }

  if (/\bwe owe|creditors?|payables?|suppliers? .*(overdue|owed)\b/i.test(q)) {
    const a = (await runView("aging", { side: "ap" })) as {
      asOf: string; overdueMinor: number; totalMinor: number;
      parties: { name: string; buckets: number[]; totalMinor: number; items: number }[];
    };
    await note("run_view aging", { side: "ap", parties: a.parties?.length });
    const top = a.parties?.[0];
    if (!top) return { outcome: "completed", summary: "Nothing is open on the AP ledger.\n\nsources: aging (side=ap)" };
    return {
      outcome: "completed",
      summary: `Open AP is ${gbpMinor(a.totalMinor)} (${gbpMinor(a.overdueMinor)} past due) at ${a.asOf}. Largest balance: ${top.name} at ${gbpMinor(top.totalMinor)} (${top.items} invoices). Detail: /analytics.\n\nsources: aging (side=ap, asOf=${a.asOf})`,
    };
  }

  if (/\bcash|bank balance|liquidity\b/i.test(q)) {
    const c = (await runView("cash", {})) as { points: { date: string; balanceMinor: number }[] };
    await note("run_view cash", { points: c.points?.length });
    const last = c.points?.at(-1);
    if (!last) return { outcome: "completed", summary: "No bank activity recorded yet.\n\nsources: cash" };
    const monthAgo = c.points.filter((p) => p.date <= addDays(last.date, -30)).at(-1);
    const change = monthAgo ? last.balanceMinor - monthAgo.balanceMinor : null;
    return {
      outcome: "completed",
      summary: `Cash is ${gbpMinor(last.balanceMinor)} as of ${last.date} (latest statement line)${
        change !== null ? `, ${change >= 0 ? "up" : "down"} ${gbpMinor(change)} over the last 30 statement days` : ""
      }. Trend chart: /analytics.\n\nsources: cash`,
    };
  }

  if (/\bwhy|moved?|flux|change[ds]?|increase|decrease|jump|drop|variance\b/i.test(q)) {
    const f = (await runView("flux", {})) as {
      period: string; prior: string;
      rows: { code: string; name: string; thisMinor: number; prevMinor: number; deltaMinor: number }[];
    };
    await note("run_view flux", { period: f.period, rows: f.rows?.length });
    const items = (f.rows ?? [])
      .map((r) => ({ ...r, contrib: -r.deltaMinor }))
      .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib));
    const profitThis = (f.rows ?? []).reduce((n, r) => n - r.thisMinor, 0);
    const profitPrev = (f.rows ?? []).reduce((n, r) => n - r.prevMinor, 0);
    const movers = items.slice(0, 3).filter((m) => m.contrib !== 0);
    if (movers.length === 0)
      return { outcome: "completed", summary: `No P&L movement between ${f.prior} and ${f.period}.\n\nsources: flux (period=${f.period})` };
    return {
      outcome: "completed",
      summary: `${f.period} result ${gbpMinor(profitThis)} vs ${gbpMinor(profitPrev)} in ${f.prior}. Biggest contributions: ${movers
        .map((m) => `${m.name} (${m.code}) ${m.contrib >= 0 ? "helped" : "hurt"} by ${gbpMinor(m.contrib)}`)
        .join("; ")}. Waterfall and drill-to-postings: /analytics.\n\nsources: flux (period=${f.period} vs ${f.prior})`,
    };
  }

  if (/\btop|biggest|largest|concentrat|spend|revenue by\b/i.test(q)) {
    const dim = /supplier|spend|vendor/i.test(q) ? "supplier" : "customer";
    const c = (await runView("counterparty", { dim })) as {
      parties: { name: string; totalMinor: number; invoices: number }[];
    };
    await note("run_view counterparty", { dim, parties: c.parties?.length });
    const top3 = (c.parties ?? []).slice(0, 3);
    if (top3.length === 0) return { outcome: "completed", summary: `No ${dim} invoices on the books yet.\n\nsources: counterparty (dim=${dim})` };
    return {
      outcome: "completed",
      summary: `Top ${dim}s by invoiced gross: ${top3
        .map((p, i) => `${i + 1}. ${p.name} ${gbpMinor(p.totalMinor)} (${p.invoices} invoices)`)
        .join("; ")}. Full ranking: /analytics.\n\nsources: counterparty (dim=${dim})`,
    };
  }

  return {
    outcome: "completed",
    summary:
      "I can't do free-text analysis without a model configured — in keyless mode I answer set question shapes from the curated views: overdue customers/suppliers (aging), cash position (cash), why the result moved (flux), top customers/suppliers (counterparty). The charts for all of these are at /analytics.\n\nsources: views catalogue",
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
  if (taskType === "ar.cash.apply" || (taskType === "eval.case" && Array.isArray(payload.candidates))) {
    return cashApplicationFallback(resolved, runId, payload, steps);
  }
  if (taskType === "ar.collections" || (taskType === "eval.case" && typeof payload.daysOverdue === "number")) {
    return collectionsFallback(resolved, runId, payload, steps);
  }
  if (taskType === "bank.reconcile" || (taskType === "eval.case" && typeof payload.bankTransactionId === "string")) {
    return bankReconcileFallback(resolved, runId, payload, steps);
  }
  if (taskType === "r2r.commentary" || (taskType === "eval.case" && Array.isArray(payload.figures))) {
    return commentaryFallback(resolved, runId, payload, steps);
  }
  if (taskType === "analyst.question" || (taskType === "eval.case" && typeof payload.question === "string")) {
    return analystFallback(resolved, runId, payload, steps);
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

  // Learned templates (D15): a supplier promoted after repeated validated
  // model extractions is handled by the deterministic parser — no model call.
  // A miss (parse can't handle it / gateway rejects) falls back to the model
  // below and is counted; repeated misses demote the template.
  const templateSupplier =
    taskType === "invoice.capture" && typeof payload.supplierCode === "string" ? payload.supplierCode : null;
  if (templateSupplier && (await getActiveTemplate(templateSupplier))) {
    await appendStep(runId, steps, {
      kind: "note",
      label: "learned template",
      detail: { supplierCode: templateSupplier, note: "layout learned from prior model extractions — extracting in code, 0 model calls" },
    });
    const result = await invoiceCaptureFallback(resolved, runId, payload, steps);
    if (result.outcome === "completed") {
      await recordHit(templateSupplier);
      await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: `${result.summary} (learned template — no model call)` } });
      return { ...result, summary: `${result.summary} (learned template — no model call)` };
    }
    await recordMiss(templateSupplier);
    await appendStep(runId, steps, {
      kind: "note",
      label: "template miss",
      detail: { supplierCode: templateSupplier, note: "deterministic parse did not produce a clean capture — falling back to the model" },
    });
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
      description: "Full context for an AP invoice: the invoice, its purchase (the approved ask), goods receipts, and case history. Use for exception investigations. invoiceId accepts the internal uuid OR the supplier invoice number (e.g. EES-D89463).",
      input_schema: {
        type: "object",
        properties: { invoiceId: { type: "string" } },
        required: ["invoiceId"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "query_records",
      description:
        "Query actual records from the governed record catalogue (read-only; server-built SQL; max 50 rows + aggregates). Entities and their filters: purchases (party=supplier code/name fragment, status, from/to request date, search=PO number) — rows include receipt and invoice counts; goods_receipts (party, search=GRN/PO number); ap_invoices (party, status, hasPurchase 'true'|'false', period YYYY-MM, search=invoice number) — aggregates include with_purchase/without_purchase counts; ar_invoices (party=customer, status, period, search); payments (status, search=payment ref); bank_transactions (status, kind, from/to, search=reference/counterparty); journals (period, sourceType, search=memo); suppliers / customers (search=code/name). All amounts are integer pence.",
      input_schema: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            enum: ["purchases", "goods_receipts", "ap_invoices", "ar_invoices", "payments", "bank_transactions", "journals", "suppliers", "customers"],
          },
          filters: { type: "object", description: "Whitelisted filters for the entity, see the description" },
          limit: { type: "number", description: "Max rows (default 20, cap 50)" },
        },
        required: ["entity"],
        additionalProperties: false,
      },
    },
    {
      name: "run_view",
      description:
        "Run one curated analytics view (read-only, governed — the only way to read figures). Views: pl-trend (params: year, or from/to YYYY-MM window), flux (params: period YYYY-MM default latest; or from/to YYYY-MM to compare that window to the equal-length prior window — use for quarter or YTD questions), aging (params: side 'ap'|'ar', asOf YYYY-MM-DD), counterparty (params: dim 'supplier'|'customer', from/to YYYY-MM), cash (params: from/to YYYY-MM). All amounts return as integer pence.",
      input_schema: {
        type: "object",
        properties: {
          viewId: { type: "string", enum: ["pl-trend", "flux", "aging", "counterparty", "cash"] },
          params: { type: "object", description: "View parameters, see the description" },
        },
        required: ["viewId"],
        additionalProperties: false,
      },
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
  let totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

  /* Prompt caching (cost control, 2026-10-03). The cache is a PREFIX match
   * over tools → system → messages; the API allows at most 4 breakpoints per
   * request. We use exactly two:
   *   1. the system prompt block — caches tools+system, identical for every
   *      run of the same agent release, shared across a whole batch;
   *   2. the LAST user message's last block — so the 2nd+ model call inside
   *      one run doesn't re-pay the conversation so far (vision PDFs are the
   *      big win: a scanned document is thousands of tokens per call).
   * Honest expectations: each model has a MINIMUM cacheable prefix (Haiku
   * 4.5: 4096 tokens; Sonnet/Opus tiers lower). A short extraction prompt on
   * the Haiku tier may be under the minimum — the API then silently caches
   * nothing (cache_creation_input_tokens: 0, no error). The reliable wins
   * are long prompts (Sonnet-tier agents) and multi-call runs carrying a
   * document. Cache read prices are PER TIER (Opus reads are 0.05× input,
   * not 0.1×) — priced in the API's rateCard, never here.
   * Rules that keep this from becoming a bug source:
   *   - NEVER mutate `messages` to add cache_control: `cachedMessages` builds
   *     a shallow copy per call, so a stale breakpoint can't accumulate on an
   *     old message (breakpoints >4 would 400 the request).
   *   - Only user-role messages get the breakpoint (assistant turns are
   *     echoed response blocks and must go back unmodified).
   *   - Anything that varies per run must sit AFTER the system block — never
   *     interpolate timestamps/ids into buildSystemPrompt, or every run
   *     misses the cache and silently pays full price.
   *   - TTL is 5 min; a batch keeps itself warm, a lone drip may re-create.
   *   - Caches are model-scoped: per-profile tiers never share entries.
   *   - Token columns on agent_run stay RAW (uncached in / out / cache
   *     written / cache read); pricing is read-time only (rateCard.ts). */
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: system, cache_control: { type: "ephemeral" } },
  ];
  const cachedMessages = (): Anthropic.MessageParam[] =>
    messages.map((m, i) => {
      if (i !== messages.length - 1 || m.role !== "user" || !Array.isArray(m.content) || m.content.length === 0)
        return m;
      const blocks = m.content;
      const content = blocks.map((b, j) =>
        j === blocks.length - 1 && (b.type === "text" || b.type === "tool_result" || b.type === "document" || b.type === "image")
          ? { ...b, cache_control: { type: "ephemeral" as const } }
          : b,
      );
      return { ...m, content };
    });

  while (modelCalls < resolved.release.maxModelCalls) {
    modelCalls++;
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemBlocks,
        tools,
        messages: cachedMessages(),
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

    /* usage.input_tokens EXCLUDES cached tokens. Store the raw split — the
     * API's rateCard prices each bucket at read time (per-tier cache rates). */
    const u = response.usage;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    totals = {
      input: totals.input + u.input_tokens,
      output: totals.output + u.output_tokens,
      cacheWrite: totals.cacheWrite + cacheWrite,
      cacheRead: totals.cacheRead + cacheRead,
    };
    if (db) {
      await db
        .update(agentRun)
        .set({
          modelCalls,
          inputTokens: totals.input,
          outputTokens: totals.output,
          cacheWriteTokens: totals.cacheWrite,
          cacheReadTokens: totals.cacheRead,
        })
        .where(eq(agentRun.id, runId));
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    await appendStep(runId, steps, {
      kind: "model_call",
      label: `model call ${modelCalls}`,
      detail: {
        stop_reason: response.stop_reason,
        text: text.slice(0, 2000),
        usage: { input: u.input_tokens, output: u.output_tokens, cacheWrite, cacheRead },
      },
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
      const resultsBefore = toolResults.length;
      // Every tool runs inside this try: a throwing tool (bad input reaching
      // SQL, API hiccup) must come back to the model as an error tool_result
      // it can recover from — never as a failed run. (Body indentation kept.)
      try {
      if (tu.name === "finish") {
        const result: LoopResult = {
          outcome: (input.outcome as LoopResult["outcome"]) ?? "completed",
          summary: String(input.summary ?? ""),
        };
        // D15: a clean model extraction counts toward promoting this
        // supplier to a learned (deterministic) template.
        if (templateSupplier && result.outcome === "completed")
          await recordLearning(templateSupplier, totals.input + totals.output + totals.cacheWrite + totals.cacheRead);
        await appendStep(runId, steps, { kind: "outcome", label: result.outcome, detail: { summary: result.summary } });
        return result;
      }
      if (tu.name === "query_records") {
        const q = input as { entity: string; filters?: Record<string, unknown>; limit?: number };
        const qs = new URLSearchParams({ entity: String(q.entity) });
        for (const [k, v] of Object.entries(q.filters ?? {}))
          if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
        if (q.limit) qs.set("limit", String(q.limit));
        const res = await apiFetch(`/analytics/records?${qs}`, { method: "GET" });
        const result = await res.json().catch(() => ({ error: `records returned non-JSON (status ${res.status})` }));
        await appendStep(runId, steps, {
          kind: "tool_call",
          label: `query_records ${String(q.entity)}`,
          detail: { input, preview: JSON.stringify(result).slice(0, 500) },
        });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result), ...(res.ok ? {} : { is_error: true }) });
        continue;
      }
      if (tu.name === "run_view") {
        const q = input as { viewId: string; params?: Record<string, unknown> };
        const result = await runView(String(q.viewId), q.params ?? {});
        await appendStep(runId, steps, {
          kind: "tool_call",
          label: `run_view ${String(q.viewId)}`,
          detail: { input, preview: JSON.stringify(result).slice(0, 500) },
        });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) });
        continue;
      }
      if (tu.name === "get_invoice_context") {
        let result: unknown = { error: "database unavailable" };
        if (db) {
          const q = input as { invoiceId: string };
          // tolerant lookup: a uuid finds by id; anything else is treated as
          // a supplier invoice number (a bare number must never 500 the run)
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.invoiceId ?? "");
          const inv = isUuid
            ? await db.query.apInvoice.findFirst({ where: (t, { eq: e }) => e(t.id, q.invoiceId) })
            : await db.query.apInvoice.findFirst({
                where: (t, { eq: e }) => e(t.supplierInvoiceNumber, q.invoiceId),
              });
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
        const res = await apiFetch(`/commands/propose`, {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await appendStep(runId, steps, { kind: "note", label: `tool ${tu.name} errored`, detail: { message } });
        if (toolResults.length === resultsBefore)
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            is_error: true,
            content: `tool ${tu.name} failed: ${message}. Adjust the input or use a different tool; do not retry identical input more than once.`,
          });
      }
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
