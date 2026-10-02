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
  // Purchase intake (plans/P2P.md M2): any task carrying free text.
  if (taskType === "purchase.request" || (taskType === "eval.case" && typeof payload.text === "string")) {
    return purchaseRequestFallback(resolved, runId, String(payload.text ?? ""), steps);
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
  const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
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

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Task type: ${taskType}\nTask payload:\n${JSON.stringify(payload, null, 2)}` },
  ];
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
