/** Dataset invariants (plans/DEMO_DATA.md): arithmetic integrity, exception
 * quotas, document linkage, bank consistency. Run after generate + render. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Dataset } from "./types.js";

export function validate(seedDir: string, checkFiles: boolean): string[] {
  const dataset: Dataset = JSON.parse(
    readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8"),
  );
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);

  // arithmetic: invoice totals = sum of lines; gross = net + vat
  for (const c of dataset.ap) {
    const net = c.invoice.lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
    if (net !== c.invoice.netMinor) err(`${c.id}: net != sum(lines)`);
    if (c.invoice.netMinor + c.invoice.vatMinor !== c.invoice.grossMinor)
      err(`${c.id}: gross != net + vat`);
  }
  for (const i of dataset.ar) {
    const net = i.lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
    if (net !== i.netMinor) err(`${i.id}: net != sum(lines)`);
    if (i.netMinor + i.vatMinor !== i.grossMinor) err(`${i.id}: gross != net + vat`);
  }

  // exception quota 12–15%, bank_detail_change exactly 2
  const exceptions = dataset.ap.filter((c) => c.exception);
  const rate = exceptions.length / dataset.ap.length;
  if (rate < 0.12 || rate > 0.155) err(`exception rate ${(rate * 100).toFixed(1)}% outside 12–15%`);
  const bdc = exceptions.filter((c) => c.exception === "bank_detail_change").length;
  if (bdc !== 2) err(`bank_detail_change count ${bdc}, expected 2`);

  // structural: taxonomy consistency
  for (const c of dataset.ap) {
    if (c.exception === "no_purchase" && c.po) err(`${c.id}: no_purchase but purchase present`);
    if (c.po && !c.requisition) err(`${c.id}: purchase without requisition context`);
    if (c.requisition) {
      const t = c.po!.totalMinor;
      const expected = t <= 50000 ? "auto" : t <= 500000 ? "standard" : "director";
      if (c.requisition.approvalBand !== expected)
        err(`${c.id}: approval band ${c.requisition.approvalBand}, expected ${expected}`);
      if (c.requisition.requestDate > c.po!.orderDate) err(`${c.id}: requested after ordered`);
    }
    if (c.exception === "missing_receipt" && c.grn) err(`${c.id}: missing_receipt but GRN present`);
    if (!c.exception && c.po && !c.grn) err(`${c.id}: clean chain missing GRN`);
    if (c.exception && c.paid) err(`${c.id}: exception invoice marked paid`);
  }

  // bank consistency: every paid AP/AR has exactly one matching bank line
  const bankRefs = new Map<string, number>();
  for (const t of dataset.bank) bankRefs.set(t.reference, (bankRefs.get(t.reference) ?? 0) + 1);
  for (const c of dataset.ap)
    if (c.paid && bankRefs.get(c.invoice.number) !== 1)
      err(`${c.id}: paid but ${bankRefs.get(c.invoice.number) ?? 0} bank lines for ${c.invoice.number}`);
  for (const i of dataset.ar)
    if (i.paid && bankRefs.get(i.number) !== 1) err(`${i.id}: paid but no single bank receipt`);

  // document linkage on disk
  if (checkFiles) {
    const files: string[] = [];
    for (const c of dataset.ap) {
      files.push(c.invoice.file, c.email.file);
      if (c.po) files.push(c.po.file);
    }
    for (const i of dataset.ar) {
      files.push(i.file);
      if (i.contractFile) files.push(i.contractFile);
      if (i.remittanceFile) files.push(i.remittanceFile);
    }
    let missing = 0;
    for (const f of new Set(files))
      if (!existsSync(path.join(seedDir, f))) {
        missing++;
        if (missing <= 5) err(`missing document: ${f}`);
      }
    if (missing > 5) err(`…and ${missing - 5} more missing documents`);
  }

  console.log(
    `validated: ${dataset.ap.length} AP chains, ${dataset.ar.length} AR invoices, ` +
      `${dataset.bank.length} bank lines, exceptions ${(rate * 100).toFixed(1)}% — ` +
      (errors.length ? `${errors.length} ERRORS` : "all invariants hold"),
  );
  return errors;
}
