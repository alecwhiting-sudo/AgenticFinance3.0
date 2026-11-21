/** EPM pure functions (plans/PM.md §3): the budget derives from NAMED driver
 * assumptions — line amounts are never typed in. Pure and I/O-free so the
 * seed builds the committed budget and the API recomputes live scenarios
 * from the same code path. Deterministic: same assumptions, same lines. */

export type DriverAssumptions = {
  consultants: number;
  utilisationPct: number; // 0-100
  dayRateMinor: number;
  productMrrMinor: number; // month 1 MRR
  productGrowthPctMonthly: number;
  subcontractPctOfConsulting: number; // 5000
  facilitiesMonthlyMinor: number; // 6100
  softwarePerHeadMinor: number; // 6200, per head per month
  supportHeads: number; // non-consultant heads carrying software seats
  travelPctOfConsulting: number; // 6300
  marketingPctOfRevenue: number; // 6400
  professionalMonthlyMinor: number; // 6500
  sundryMonthlyMinor: number; // 6900
  /** working days per period code, e.g. {"2026-01": 22} */
  workingDays: Record<string, number>;
};

export type PlanLineInput = { accountCode: string; periodCode: string; amountMinor: number; note?: string };

/** Round to the nearest £500 so budget figures read as planned, not copied. */
const planned = (minor: number) => Math.round(minor / 50000) * 50000;

/** Build the full-year budget lines, SIGNED AS POSTED (income negative,
 * expense positive) to match erp.journal_line — plans/PM.md §2. */
export function buildBudgetLines(a: DriverAssumptions, year: number): PlanLineInput[] {
  const lines: PlanLineInput[] = [];
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  months.forEach((period, idx) => {
    const wd = a.workingDays[period] ?? 21;
    const consulting = planned(a.consultants * (a.utilisationPct / 100) * a.dayRateMinor * wd);
    const product = planned(a.productMrrMinor * Math.pow(1 + a.productGrowthPctMonthly / 100, idx));
    const revenue = consulting + product;
    const push = (accountCode: string, amountMinor: number, note: string) => {
      if (amountMinor !== 0) lines.push({ accountCode, periodCode: period, amountMinor, note });
    };
    push("4000", -consulting, `${a.consultants} consultants × ${a.utilisationPct}% × £${(a.dayRateMinor / 100).toFixed(0)}/day × ${wd}d`);
    push("4100", -product, `MRR £${(a.productMrrMinor / 100).toFixed(0)} growing ${a.productGrowthPctMonthly}%/mo`);
    push("5000", planned(consulting * (a.subcontractPctOfConsulting / 100)), `${a.subcontractPctOfConsulting}% of consulting revenue`);
    push("6100", planned(a.facilitiesMonthlyMinor), "facilities fixed cost");
    push("6200", planned(a.softwarePerHeadMinor * (a.consultants + a.supportHeads)), `£${(a.softwarePerHeadMinor / 100).toFixed(0)}/head × ${a.consultants + a.supportHeads} heads`);
    push("6300", planned(consulting * (a.travelPctOfConsulting / 100)), `${a.travelPctOfConsulting}% of consulting revenue`);
    push("6400", planned(revenue * (a.marketingPctOfRevenue / 100)), `${a.marketingPctOfRevenue}% of total revenue`);
    push("6500", planned(a.professionalMonthlyMinor), "professional fees fixed");
    push("6900", planned(a.sundryMonthlyMinor), "sundry fixed");
  });
  return lines;
}
