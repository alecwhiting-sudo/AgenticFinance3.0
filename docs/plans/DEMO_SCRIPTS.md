# Demo scripts — three ways to run the machine

Three scenarios for showing the agentic finance function to a CFO, all built
on the same dataset (~300 AP chains, 400 AR invoices, 508 bank lines spread
across the demo months) and the same pipe. The difference is tempo and
framing. Companion build items in §5.

## 1. Scenario A — "What if your volume were 10x?" (lead framing, Alec 2026-10-03)

A before/after stress test — it answers the CFO's real question (month-end
peak, growth, acquisition) and, being an explicit what-if, nobody litigates
document dates.

1. **Baseline month.** Process one month normally (~120 items). Record the
   numbers: elapsed time, straight-through %, human touches.
2. **"Now imagine you 10x'd overnight."** Run the entire dataset (~1,200
   items: 300 AP chains, 400 AR invoices, 508 bank lines — almost exactly
   10x a month) at full speed as one month's volume, dashboard (§4) on
   screen: counters draining, elapsed timer, exceptions accumulating,
   GL balance staying at zero.
3. **The comparison panel.** Baseline vs 10x side by side: items, minutes,
   straight-through count, **human touches** (barely moved — exceptions
   scale with the ~12% exception *rate*, agents resolve most, only
   judgement calls reach the inbox), and estimated model cost from the rate
   card. The lines: *"10x the volume; your involvement is still this queue
   of nine."* / *"Pennies per transaction, flat."* Finish by resolving one
   exception through the approval flow.

**Honesty note for delivery:** elapsed time is real but measured on a small
demo box — present as throughput ("~N transactions/min on demo
infrastructure, and this parallelises"), not a precision benchmark. The
claim that survives scrutiny: machine time scales linearly and cheaply;
human time scales only with genuine exceptions.

## 1b. Scenario A2 — "Replay the full history" (same button, different story)

The same end-to-end run as §1 step 2, but told straight: the dataset is ten
months of history and the machine replays it **as ten months** — dates
respected, periods landing one after another, month-ends included. Two
framings that both hold up:

- **Cutover day** (migration-minded buyers): *"You've just adopted the
  platform; here is your historical transaction file — switch it on."*
  Replaying history into a new system of record is a real enterprise event,
  and the history already contains the payments, so nothing reads overdue.
- **The audit guarantee** (technical buyers): same events, same books,
  every time (D13). Run it twice if anyone doubts it.

Mechanically this is today's "replay from zero" with the §4 dashboard on
top — the backlog-by-month bars drain in date order and the period close
markers tick past. No extra build beyond §5 items 1–2; the loader keeps its
plain full-replay mode alongside the one-month and stop-after-period
controls.

## 2. Scenario B — "Run the year in fast-forward" (month by month)

**Framing.** *"Let's run your finance function, one month per minute."*

**The loop, per month:** process the month's transactions → stop → look
around: P2P exceptions, bank rec, run month-end, P&L/balance sheet, the
Close Agent's flux commentary → resolve anything interesting → "process
next month". The in-between inspection is the point: it's the CFO's actual
job on a loop, and every built feature gets screen time.

**Good stopping moments:** a month with a price-variance cluster; the first
month with accruals reversing; a month with heavy AR collections.

## 3. Scenario C — "This morning" (daily, live)

**Framing.** *"It's 9am. Here's what arrived overnight."*

**The run.** One "simulate a day" action drips a believable morning's mix —
a clean e-invoice (straight through), a scanned PDF (vision extraction),
one exception (agent investigates, proposes, human approves), a customer
receipt (cash application). Watch on the live flow view; finish in the
approval inbox: *"your whole involvement in today's finance function was
these two clicks."*

## 4. The pipeline dashboard ("mission control")

One screen, linked from Admin, presentable full-screen:

- **Backlog by month** — stacked bars (AP / AR / bank), draining live.
- **Counters** — processed / remaining, **elapsed time**, items per minute.
- **The control split** — straight-through vs agent-investigated vs
  awaiting-human. The CFO line: "912 posted untouched, 36 needed judgement,
  9 needed you."
- **Integrity strip** — GL balance ✓ 0, journals = events.
- The existing live activity feed alongside.

## 5. Build items — ✅ built 2026-10-03

1. ✅ Mission control at `/admin/pipeline` (web) over `GET /admin/pipeline`
   (api): backlog by month (AP/AR/bank) draining live, elapsed + items/min,
   control split (straight-through / exceptions / agent queue / awaiting
   human), integrity strip, runs table with the honesty footnote.
2. ✅ Loader: `nextMonthOnly` incremental mode (admin reset `mode:"month"`)
   with cross-month duplicate memory and payment catch-up (a payment dated
   in a later month waits for that month's load); `paceMs:0` = full speed;
   finished runs remembered in memory (`runs`, capped 12 — clears on
   redeploy, fine for a demo) for the §1 side-by-side.
3. ✅ `POST /admin/simulate-day`: clean + scan + one random exception
   dripped, plus a cash-application investigation when an unapplied receipt
   exists.
3b. ✅ Tangibility pass (Alec, 2026-10-03): three named lanes (supplier
   invoices / customer billing / bank feed) instead of one abstract bar;
   "Process {month} →" names the next month and "Run remaining months"
   auto-advances with a 4s pause at each boundary (reset mode `months`);
   live ticker of real names/amounts; plain-English end-of-run receipt with
   links to open exceptions and approvals; "model spend today" tile (actual
   tokens priced on the rate card) with every loader button labelled "no
   model calls" — the big runs are deterministic, only drips/agents/evals
   spend tokens. Container boot no longer auto-fills empty books unless
   `AUTO_LOAD_DATASET=true` (or `RESET_DATASET=true`), so month-by-month
   demos survive restarts.
4. Everything else reuses replay, drip, month-end, commentary, approvals as
   built. Measured on the dev box: full dataset (~1,200 transactions) in
   ~12s at full speed, 1,159 journals, balance 0.
