/** HTML templates for rendered documents. Three AP invoice designs (one
 * deliberately scrappy to make extraction look hard), a PO, Brightline's AR
 * invoice, a one-page MSA contract and a remittance advice. Every document
 * footer carries a small machine-readable JSON block (grey, 5pt) — honest
 * "text layer" that keyless deterministic extraction can parse. */
import type { ApChain, ArInvoice, Line } from "./types.js";

const gbp = (minor: number) => `£${(minor / 100).toFixed(2)}`;

const page = (body: string, extraCss = "") => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; margin: 40px; color: #1a1a1a; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 14px 0; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #666; border-bottom: 1px solid #ccc; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; }
  .r { text-align: right; }
  .mrz { color: #bbb; font-size: 5pt; margin-top: 30px; word-break: break-all; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .muted { color: #666; }
  .tot td { font-weight: bold; border-top: 2px solid #333; }
  ${extraCss}
</style></head><body>${body}</body></html>`;

const linesTable = (lines: Line[], showAccount = false) => `
<table><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit</th>${showAccount ? "<th>Acct</th>" : ""}<th class="r">Amount</th></tr>
${lines
  .map(
    (l) =>
      `<tr><td>${l.description}</td><td class="r">${l.qty}</td><td class="r">${gbp(l.unitPriceMinor)}</td>${showAccount ? `<td>${l.account}</td>` : ""}<td class="r">${gbp(l.qty * l.unitPriceMinor)}</td></tr>`,
  )
  .join("")}
</table>`;

const mrz = (data: Record<string, unknown>) =>
  `<div class="mrz">AF-DATA ${JSON.stringify(data)}</div>`;

export function apInvoiceHtml(chain: ApChain, supplierName: string): string {
  const inv = chain.invoice;
  const data = {
    kind: "ap_invoice",
    supplier: supplierName,
    number: inv.number,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    po: chain.po?.number ?? null,
    netMinor: inv.netMinor,
    vatMinor: inv.vatMinor,
    grossMinor: inv.grossMinor,
    lines: inv.lines,
  };
  const totals = `<table>
    <tr><td class="r">Net</td><td class="r" style="width:110px">${gbp(inv.netMinor)}</td></tr>
    <tr><td class="r">VAT 20%</td><td class="r">${gbp(inv.vatMinor)}</td></tr>
    <tr class="tot"><td class="r">Total due</td><td class="r">${gbp(inv.grossMinor)}</td></tr>
  </table>`;
  const ref = chain.po ? `<p class="muted">Your reference: ${chain.po.number}</p>` : "";

  if (inv.template === 0)
    return page(
      `<div style="display:flex;justify-content:space-between">
        <div><h1>${supplierName}</h1><p class="muted">Accounts: remit within terms</p></div>
        <div style="text-align:right"><h1 style="color:#0d5c63">INVOICE</h1><p>${inv.number}</p></div>
      </div>
      <p>Invoice date: <b>${inv.invoiceDate}</b> &nbsp; Due: <b>${inv.dueDate}</b></p>
      <p>Bill to: Brightline Ltd, 14 Foundry Lane, Leeds LS1 4DQ</p>${ref}
      ${linesTable(inv.lines)}${totals}${mrz(data)}`,
    );
  if (inv.template === 1)
    return page(
      `<table style="margin:0"><tr>
        <td style="border:none"><h1 style="font-family:Georgia,serif">${supplierName}</h1></td>
        <td style="border:none;text-align:right">Tax invoice<br><b>${inv.number}</b><br>${inv.invoiceDate}</td>
      </tr></table><hr>
      <p><b>To:</b> Brightline Ltd · 14 Foundry Lane · Leeds LS1 4DQ<br>
      <b>Payment due:</b> ${inv.dueDate}${chain.po ? ` · <b>PO:</b> ${chain.po.number}` : ""}</p>
      ${linesTable(inv.lines)}${totals}
      <p class="muted">Registered in England. VAT GB ${Math.abs(hash(inv.number)) % 900000000}</p>${mrz(data)}`,
      "body{font-family:Georgia,serif}",
    );
  // template 2: the scrappy one — cramped, typewriter, totals inline in text
  return page(
    `<p style="font-size:14px"><b>${supplierName.toUpperCase()}</b> -- invoice no ${inv.number} dt ${inv.invoiceDate}</p>
    <p>to: brightline ltd, leeds${chain.po ? ` / po ${chain.po.number}` : ""} / terms: pay by ${inv.dueDate}</p>
    ${inv.lines.map((l) => `<p>- ${l.description} x${l.qty} @ ${gbp(l.unitPriceMinor)} = ${gbp(l.qty * l.unitPriceMinor)}</p>`).join("")}
    <p>net ${gbp(inv.netMinor)} / vat ${gbp(inv.vatMinor)} / <b>TOTAL ${gbp(inv.grossMinor)}</b></p>
    <p class="muted">thank you for yr business</p>${mrz(data)}`,
    "body{font-family:'Courier New',monospace;font-size:11px;margin:28px}",
  );
}

export function poHtml(chain: ApChain, supplierName: string): string {
  const po = chain.po!;
  return page(
    `<div style="display:flex;justify-content:space-between">
      <div><h1 style="color:#0d9488">Brightline Ltd</h1><p class="muted">14 Foundry Lane, Leeds LS1 4DQ</p></div>
      <div style="text-align:right"><h1>PURCHASE ORDER</h1><p><b>${po.number}</b><br>${po.orderDate}</p></div>
    </div>
    <p><b>Supplier:</b> ${supplierName}</p>
    ${linesTable(po.lines, true)}
    <table><tr class="tot"><td class="r">Order total (ex VAT)</td><td class="r" style="width:110px">${gbp(po.totalMinor)}</td></tr></table>
    <p class="muted">Goods/services must reference this PO on invoicing.</p>
    ${mrz({ kind: "purchase_order", number: po.number, supplier: supplierName, orderDate: po.orderDate, totalMinor: po.totalMinor, lines: po.lines })}`,
  );
}

export function arInvoiceHtml(inv: ArInvoice, customerName: string): string {
  return page(
    `<div style="display:flex;justify-content:space-between">
      <div><h1 style="color:#0d9488">Brightline Ltd</h1><p class="muted">14 Foundry Lane, Leeds LS1 4DQ · VAT GB 432 1987 55</p></div>
      <div style="text-align:right"><h1>INVOICE</h1><p><b>${inv.number}</b><br>${inv.invoiceDate}</p></div>
    </div>
    <p><b>To:</b> ${customerName}</p>
    ${linesTable(inv.lines)}
    <table>
      <tr><td class="r">Net</td><td class="r" style="width:110px">${gbp(inv.netMinor)}</td></tr>
      <tr><td class="r">VAT 20%</td><td class="r">${gbp(inv.vatMinor)}</td></tr>
      <tr class="tot"><td class="r">Total due by ${inv.dueDate}</td><td class="r">${gbp(inv.grossMinor)}</td></tr>
    </table>
    <p class="muted">Please quote ${inv.number} on payment.</p>
    ${mrz({ kind: "ar_invoice", number: inv.number, customer: customerName, invoiceDate: inv.invoiceDate, grossMinor: inv.grossMinor })}`,
  );
}

export function contractHtml(customerName: string, code: string, startDate: string): string {
  return page(
    `<h1>Master Services Agreement</h1>
    <p class="muted">Between Brightline Ltd ("Supplier") and ${customerName} ("Client") · Ref ${code}-MSA · Effective ${startDate}</p>
    <h3>1. Services</h3><p>The Supplier will provide consulting, managed services and analytics products as set out in statements of work agreed from time to time.</p>
    <h3>2. Charges</h3><p>Charges are per the Supplier's rate card current at the date of each statement of work. Invoices are payable within the Client's agreed payment terms. Late payment accrues interest at 4% above base rate.</p>
    <h3>3. Term</h3><p>This agreement runs for 12 months from the effective date and renews automatically unless terminated on 60 days' notice.</p>
    <h3>4. Liability</h3><p>Each party's aggregate liability is capped at the fees paid in the preceding 12 months. Nothing limits liability for fraud.</p>
    <p style="margin-top:36px">Signed for Brightline Ltd: ______________________　　Signed for ${customerName}: ______________________</p>
    ${mrz({ kind: "contract", customer: customerName, ref: `${code}-MSA`, startDate })}`,
  );
}

export function remittanceHtml(inv: ArInvoice, customerName: string): string {
  return page(
    `<h1>Remittance advice</h1>
    <p class="muted">From ${customerName}</p>
    <table>
      <tr><th>Invoice</th><th>Invoice date</th><th class="r">Amount paid</th><th>Payment date</th></tr>
      <tr><td>${inv.number}</td><td>${inv.invoiceDate}</td><td class="r">${gbp(inv.grossMinor)}</td><td>${inv.paidDate}</td></tr>
    </table>
    <p class="muted">Paid by BACS to your account ending 4417.</p>
    ${mrz({ kind: "remittance", invoice: inv.number, amountMinor: inv.grossMinor, paidDate: inv.paidDate })}`,
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
