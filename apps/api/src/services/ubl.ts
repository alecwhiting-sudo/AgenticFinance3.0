/** Deterministic UBL 2.1 e-invoice parser (plans/DEMO_DATA.md format mix).
 * E-invoices are structured data — no model call, ever: the demo contrast to
 * PDF extraction. Parses the canonical shape the Studio emits; anything it
 * cannot read loudly returns null rather than guessing. */

export type UblInvoice = {
  number: string;
  invoiceDate: string;
  dueDate: string;
  poNumber: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  lines: { description: string; qty: number; unitPriceMinor: number }[];
};

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? unescapeXml(m[1]!.trim()) : null;
};

const minor = (s: string | null): number | null => {
  if (s === null || !/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
};

export function parseUblInvoice(xml: string): UblInvoice | null {
  if (!/urn:oasis:names:specification:ubl:schema:xsd:Invoice-2/.test(xml)) return null;
  const number = tag(xml, "cbc:ID"); // first cbc:ID is the invoice id
  const invoiceDate = tag(xml, "cbc:IssueDate");
  const dueDate = tag(xml, "cbc:DueDate");
  const vatMinor = minor(tag(xml, "cbc:TaxAmount"));
  const netMinor = minor(tag(xml, "cbc:LineExtensionAmount"));
  const grossMinor = minor(tag(xml, "cbc:PayableAmount"));
  if (!number || !invoiceDate || !dueDate || netMinor === null || vatMinor === null || grossMinor === null)
    return null;

  const orderRef = xml.match(/<cac:OrderReference>[\s\S]*?<cbc:ID>([^<]*)<\/cbc:ID>/);
  const supplierBlock = xml.match(/<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/);
  const supplierCode = supplierBlock ? tag(supplierBlock[1]!, "cbc:ID") : null;
  const supplierName = supplierBlock ? tag(supplierBlock[1]!, "cbc:Name") : null;

  const lines: UblInvoice["lines"] = [];
  for (const m of xml.matchAll(/<cac:InvoiceLine>([\s\S]*?)<\/cac:InvoiceLine>/g)) {
    const block = m[1]!;
    const qty = Number(tag(block, "cbc:InvoicedQuantity") ?? NaN);
    const unitPriceMinor = minor(tag(block, "cbc:PriceAmount"));
    const description = tag(block, "cbc:Name");
    if (!Number.isInteger(qty) || unitPriceMinor === null || !description) return null;
    lines.push({ description, qty, unitPriceMinor });
  }
  if (lines.length === 0) return null;

  return {
    number,
    invoiceDate,
    dueDate,
    poNumber: orderRef ? unescapeXml(orderRef[1]!.trim()) : null,
    supplierCode,
    supplierName,
    netMinor,
    vatMinor,
    grossMinor,
    lines,
  };
}
