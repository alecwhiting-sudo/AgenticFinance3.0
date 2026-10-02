/** Additive format mix (plans/DEMO_DATA.md): on top of the original text
 * PDFs, a deterministic subset of AP invoices gains an alternate primary
 * format — Peppol/UBL XML e-invoices (deterministic intake) or scan-style
 * image PDFs with NO text layer (force the vision extraction path). The
 * original files are never touched. Also reserves a handful of unseen scan
 * invoices for the live drip. No LLM, no network. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import type { ApChain, Dataset, Line } from "./types.js";
import { apInvoiceHtml } from "./templates.js";
import { mulberry32, int, pick } from "./rng.js";

const FORMAT_SEED = 0x5ca9f0; // independent of the dataset seed: additive only

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const gbp = (minor: number) => (minor / 100).toFixed(2);

/** Minimal UBL 2.1 Invoice — enough structure to parse deterministically. */
export function ublInvoiceXml(
  inv: {
    number: string;
    invoiceDate: string;
    dueDate: string;
    lines: Line[];
    netMinor: number;
    vatMinor: number;
    grossMinor: number;
  },
  supplier: { code: string; name: string },
  poNumber: string | null,
): string {
  const lines = inv.lines
    .map(
      (l, i) => `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">${l.qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="GBP">${gbp(l.qty * l.unitPriceMinor)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEscape(l.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="GBP">${gbp(l.unitPriceMinor)}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017</cbc:CustomizationID>
  <cbc:ID>${xmlEscape(inv.number)}</cbc:ID>
  <cbc:IssueDate>${inv.invoiceDate}</cbc:IssueDate>
  <cbc:DueDate>${inv.dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>GBP</cbc:DocumentCurrencyCode>
${poNumber ? `  <cac:OrderReference><cbc:ID>${xmlEscape(poNumber)}</cbc:ID></cac:OrderReference>\n` : ""}  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID>${xmlEscape(supplier.code)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${xmlEscape(supplier.name)}</cbc:Name></cac:PartyName>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party><cac:PartyName><cbc:Name>Brightline Interiors Ltd</cbc:Name></cac:PartyName></cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="GBP">${gbp(inv.vatMinor)}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="GBP">${gbp(inv.netMinor)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="GBP">${gbp(inv.netMinor)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="GBP">${gbp(inv.grossMinor)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="GBP">${gbp(inv.grossMinor)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>
`;
}

/** Degrade the invoice HTML into a scan: skew, grayscale, noise — and strip
 * the AF-DATA machine-readable footer so only the pixels carry the data. */
function scanHtml(html: string): string {
  return html
    .replace(/<div class="mrz">AF-DATA [^<]*<\/div>/, "")
    .replace(
      "</head>",
      `<style>
        html { background: #8a8a8a; }
        body {
          transform: rotate(-0.55deg) scale(0.985);
          filter: grayscale(0.92) contrast(1.22) brightness(1.05) blur(0.4px);
        }
        body::after {
          content: ""; position: fixed; inset: 0; pointer-events: none;
          background-image:
            radial-gradient(circle at 18% 28%, rgba(0,0,0,.05), transparent 40%),
            radial-gradient(circle at 78% 82%, rgba(0,0,0,.08), transparent 35%),
            repeating-linear-gradient(3deg, transparent 0 2px, rgba(0,0,0,.013) 2px 3px);
        }
      </style></head>`,
    );
}

async function renderScanPdf(pg: Page, html: string, outPath: string): Promise<void> {
  await pg.setContent(scanHtml(html), { waitUntil: "load" });
  const jpg = await pg.screenshot({ type: "jpeg", quality: 52, fullPage: false });
  await pg.setContent(
    `<html><head><style>@page{size:A4;margin:0}body{margin:0}img{width:100vw;height:100vh;object-fit:cover}</style></head><body><img src="data:image/jpeg;base64,${jpg.toString("base64")}"></body></html>`,
    { waitUntil: "load" },
  );
  await pg.pdf({ path: outPath, format: "A4", printBackground: true });
}

export type DripScanEntry = {
  supplierCode: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  lines: Line[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  file: string;
};

export async function formats(
  seedDir: string,
  counts = { scan: 50, xml: 110, dripScan: 6 },
): Promise<void> {
  const datasetPath = path.join(seedDir, "generated/dataset.json");
  const dataset: Dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  const supplierByCode = new Map(dataset.suppliers.map((s) => [s.code, s]));
  mkdirSync(path.join(seedDir, "documents/ap-xml"), { recursive: true });
  mkdirSync(path.join(seedDir, "documents/ap-scan"), { recursive: true });
  mkdirSync(path.join(seedDir, "documents/drip-scan"), { recursive: true });

  // deterministic disjoint selection over a stable order
  const rng = mulberry32(FORMAT_SEED);
  const shuffled = [...dataset.ap].sort((a, b) => a.id.localeCompare(b.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const scanSet = new Set(shuffled.slice(0, counts.scan).map((c) => c.id));
  const xmlSet = new Set(shuffled.slice(counts.scan, counts.scan + counts.xml).map((c) => c.id));

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  const pg = await browser.newPage({ viewport: { width: 794, height: 1123 } });

  let nScan = 0;
  let nXml = 0;
  for (const chain of dataset.ap) {
    const sup = supplierByCode.get(chain.supplierCode)!;
    const base = path.basename(chain.invoice.file, ".pdf");
    if (xmlSet.has(chain.id)) {
      const alt = `documents/ap-xml/${base}.xml`;
      writeFileSync(
        path.join(seedDir, alt),
        ublInvoiceXml(chain.invoice, sup, chain.po?.number ?? null),
      );
      chain.invoice.format = "ubl_xml";
      chain.invoice.altFile = alt;
      nXml++;
    } else if (scanSet.has(chain.id)) {
      const alt = `documents/ap-scan/${base}.pdf`;
      await renderScanPdf(pg, apInvoiceHtml(chain, sup.name), path.join(seedDir, alt));
      chain.invoice.format = "scan_pdf";
      chain.invoice.altFile = alt;
      nScan++;
      if (nScan % 10 === 0) console.log(`rendered ${nScan} scan PDFs…`);
    } else if (chain.invoice.format) {
      delete chain.invoice.format;
      delete chain.invoice.altFile;
    }
  }

  // Reserved drip scans: unseen invoices (fresh numbers) against existing
  // suppliers, so the live demo can land a document with no text layer.
  const dripRng = mulberry32(FORMAT_SEED ^ 0x9e3779b9);
  const manifest: DripScanEntry[] = [];
  const dripSuppliers = dataset.suppliers.filter((s) => s.account);
  for (let i = 0; i < counts.dripScan; i++) {
    const sup = pick(dripRng, dripSuppliers);
    const qty = int(dripRng, 1, 5);
    const unit = int(dripRng, 4000, 60000);
    const net = qty * unit;
    const vat = Math.round(net * 0.2);
    const number = `${sup.code.replace("SUP-", "DS")}-${int(dripRng, 10000, 99999)}`;
    const today = new Date().toISOString().slice(0, 10);
    const due = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
    const inv: DripScanEntry = {
      supplierCode: sup.code,
      number,
      invoiceDate: today,
      dueDate: due,
      lines: [
        {
          description: pick(dripRng, [
            "Office refurbishment materials",
            "Monthly service retainer",
            "Project consumables",
            "Equipment hire",
          ]),
          qty,
          unitPriceMinor: unit,
          account: sup.account,
        },
      ],
      netMinor: net,
      vatMinor: vat,
      grossMinor: net + vat,
      file: `documents/drip-scan/${number}.pdf`,
    };
    const pseudoChain = {
      ...dataset.ap[0]!,
      supplierCode: sup.code,
      po: null,
      invoice: { ...dataset.ap[0]!.invoice, ...inv, template: 1 },
    } as ApChain;
    await renderScanPdf(pg, apInvoiceHtml(pseudoChain, sup.name), path.join(seedDir, inv.file));
    manifest.push(inv);
  }
  writeFileSync(
    path.join(seedDir, "documents/drip-scan/manifest.json"),
    JSON.stringify(manifest, null, 1),
  );

  await browser.close();
  writeFileSync(datasetPath, JSON.stringify(dataset, null, 1));
  console.log(
    `format mix: ${nXml} UBL XML e-invoices, ${nScan} scan PDFs, ${counts.dripScan} reserved drip scans`,
  );
}
