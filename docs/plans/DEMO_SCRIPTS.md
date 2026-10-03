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

**Variant framing — "Cutover day"** (for migration-minded technical
buyers): *"You've just adopted the platform; here is your historical
transaction file — switch it on."* Replaying history through a new system
of record is a real enterprise event, the history already contains the
payments, and it quietly showcases the replay guarantee: same events, same
books (D13).

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

## 5. Build items (not started; small)

1. Pipeline dashboard page — front end over existing `/admin/status` job
   progress + activity SSE; new API: per-month backlog/processed breakdown
   and straight-through/agent/human split.
2. Loader controls — "stop after period" / load-one-month, "process next
   month" resume, true full-speed mode, elapsed + throughput in job status;
   dashboard remembers the baseline run for the §1 side-by-side.
3. "Simulate a day" composite drip bundle.
4. Nothing else: scenarios reuse replay, drip, month-end, commentary,
   approvals as built.
