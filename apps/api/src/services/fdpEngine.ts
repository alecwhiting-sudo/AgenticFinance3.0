/** The deterministic derivation engine (D13's second entry posture):
 * business-initiated events arrive WITHOUT accounting; this engine derives
 * the account-coded deltas from the event's details plus versioned
 * parameters. Pure functions of their inputs — same event + same parameters
 * ⇒ same deltas, so replay reproduces history. No model call, ever. */

export type Delta = { accountCode: string; amountMinor: number; memo?: string };

/** A month-end schedule entry as stored in the active fdp.parameter_set. */
export type MonthEndSchedule = {
  key: string;
  kind: "prepayment_release" | "accrual" | "recurring";
  description: string;
  accountDr: string;
  accountCr: string;
  amountMinor: number;
};

/** period.tick: one schedule entry applied to one period. The optional
 * `reversal` flag negates the posting (accruals auto-reverse next period). */
export function deriveMonthEndDeltas(
  schedule: MonthEndSchedule,
  reversal = false,
): Delta[] {
  const sign = reversal ? -1 : 1;
  const label = reversal ? `Reversal: ${schedule.description}` : schedule.description;
  return [
    { accountCode: schedule.accountDr, amountMinor: sign * schedule.amountMinor, memo: label },
    { accountCode: schedule.accountCr, amountMinor: -sign * schedule.amountMinor, memo: label },
  ];
}

/** Registry: eventType → derivation. Events posted with `deltas: null` are
 * routed here by the pipe; unknown types fail loudly (no silent economics). */
export function deriveDeltas(eventType: string, details: Record<string, unknown>): Delta[] {
  switch (eventType) {
    case "period.tick": {
      const schedule = details.schedule as MonthEndSchedule | undefined;
      if (!schedule) throw new Error("period.tick event has no schedule in details");
      return deriveMonthEndDeltas(schedule, details.reversal === true);
    }
    default:
      throw new Error(`no derivation engine for event type "${eventType}"`);
  }
}

/** Last day of a YYYY-MM period, as YYYY-MM-DD. */
export function periodEnd(periodCode: string): string {
  const [y, m] = periodCode.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${periodCode}-${String(last).padStart(2, "0")}`;
}
