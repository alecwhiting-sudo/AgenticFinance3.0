# Demo scripts — three ways to run the machine

Three scenarios for showing the agentic finance function to a CFO, all built
on the same dataset (~300 AP chains, 400 AR invoices, 508 bank lines spread
across the demo months) and the same pipe. The difference is tempo and
framing. Companion build items in §5.

## 1. Scenario A — "Cutover day" (everything at once, timed)

**Framing.** Not "ten months of unpaid suppliers" — that's implausible as
operations. Frame it as a **migration/cutover**: *"You've just adopted the
platform. Here is your company's historical transaction file — every
invoice, goods receipt, payment, bank line. Switch it on."* Replaying
history through a new system of record is exactly what large businesses do
at cutover, and the history already contains the payments, so nothing reads
as overdue. (Fallback framing if ever needed: "treat this as one month's
volume"; weaker because document dates are visible.)

**The run.** Admin → replay from zero at full speed, with the pipeline
dashboard (§4) on screen: backlog bars draining month by month, elapsed
timer, throughput, exceptions accumulating in the queue, GL balance staying
at zero.

**The landing.** When it finishes: *"N transactions. M minutes. 0 out of
balance. X went straight through untouched; Y needed an agent's judgement;
Z are waiting for a human — and here they are."* Open the exceptions queue
and resolve one through the approval flow.

**The quiet flex** (technical buyers only): same events, same books —
replay is the audit guarantee, not a demo trick (D13).

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
2. Loader controls — "stop after period", "process next month" resume,
   true full-speed mode, elapsed + throughput in job status.
3. "Simulate a day" composite drip bundle.
4. Nothing else: scenarios reuse replay, drip, month-end, commentary,
   approvals as built.
