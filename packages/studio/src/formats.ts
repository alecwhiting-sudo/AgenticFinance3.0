/** Additive format mix (plans/DEMO_DATA.md): on top of the original text
 * PDFs, a deterministic subset of AP invoices gains an alternate primary
 * format — Peppol/UBL XML e-invoices (deterministic intake) or scan-style
 * image PDFs with NO text layer (force the vision extraction path). The
 * original files are never touched. Also reserves a handful of unseen scan
 * invoices for the live drip. No LLM, no network. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
 * the AF-DATA machine-readable footer so only the pixels carry the data.
 * The "poor" tier (dataset v2) is a genuinely bad office scan: more skew,
 * heavier blur and noise, washed-out contrast — vision extraction must
 * escalate when it cannot read a figure, never guess. */
function scanHtml(html: string, quality: "normal" | "poor" = "normal"): string {
  const bodyFx =
    quality === "poor"
      ? `transform: rotate(-1.7deg) scale(0.96) translateX(6px);
         filter: grayscale(0.95) contrast(0.82) brightness(1.18) blur(0.9px);`
      : `transform: rotate(-0.55deg) scale(0.985);
         filter: grayscale(0.92) contrast(1.22) brightness(1.05) blur(0.4px);`;
  const noise =
    quality === "poor"
      ? `radial-gradient(circle at 12% 18%, rgba(0,0,0,.14), transparent 30%),
         radial-gradient(circle at 82% 74%, rgba(0,0,0,.18), transparent 28%),
         radial-gradient(circle at 48% 95%, rgba(0,0,0,.1), transparent 22%),
         repeating-linear-gradient(2deg, transparent 0 1px, rgba(0,0,0,.05) 1px 2px),
         repeating-linear-gradient(91deg, transparent 0 7px, rgba(255,255,255,.08) 7px 8px)`
      : `radial-gradient(circle at 18% 28%, rgba(0,0,0,.05), transparent 40%),
         radial-gradient(circle at 78% 82%, rgba(0,0,0,.08), transparent 35%),
         repeating-linear-gradient(3deg, transparent 0 2px, rgba(0,0,0,.013) 2px 3px)`;
  return html
    .replace(/<div class="mrz">AF-DATA [^<]*<\/div>/, "")
    .replace(
      "</head>",
      `<style>
        html { background: #8a8a8a; }
        body { ${bodyFx} }
        body::after {
          content: ""; position: fixed; inset: 0; pointer-events: none;
          background-image: ${noise};
        }
      </style></head>`,
    );
}

async function renderScanPdf(
  pg: Page,
  html: string,
  outPath: string,
  quality: "normal" | "poor" = "normal",
): Promise<void> {
  await pg.setContent(scanHtml(html, quality), { waitUntil: "load" });
  const jpg = await pg.screenshot({ type: "jpeg", quality: quality === "poor" ? 26 : 52, fullPage: false });
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
  counts: {
    scan: number;
    xml: number;
    dripScan: number;
    v2scan?: number;
    v2xml?: number;
    v2poor?: number;
  } = { scan: 50, xml: 110, dripScan: 6, v2scan: 25, v2xml: 25, v2poor: 10 },
): Promise<void> {
  const datasetPath = path.join(seedDir, "generated/dataset.json");
  const dataset: Dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  const supplierByCode = new Map(dataset.suppliers.map((s) => [s.code, s]));
  mkdirSync(path.join(seedDir, "documents/ap-xml"), { recursive: true });
  mkdirSync(path.join(seedDir, "documents/ap-scan"), { recursive: true });
  mkdirSync(path.join(seedDir, "documents/drip-scan"), { recursive: true });

  // deterministic disjoint selection over a stable order. The v1 selection
  // runs over the v1 chains ONLY (ap-0001..ap-0300) so its assignments stay
  // byte-identical forever; v2 chains get their own pass below.
  const isV1 = (c: ApChain) => Number(c.id.slice(3)) <= 300;
  const rng = mulberry32(FORMAT_SEED);
  const shuffled = [...dataset.ap].filter(isV1).sort((a, b) => a.id.localeCompare(b.id));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const scanSet = new Set(shuffled.slice(0, counts.scan).map((c) => c.id));
  const xmlSet = new Set(shuffled.slice(counts.scan, counts.scan + counts.xml).map((c) => c.id));

  // v2 pass (dataset v2): among the Jan–Mar chains — leaving the multi-page
  // and IBAN-mismatch plants as text PDFs so their planted details stay
  // visible — ~25 become UBL e-invoices and ~25 become scans, the first 10
  // of them at the POOR quality tier.
  const poorSet = new Set<string>();
  {
    const rng2 = mulberry32(FORMAT_SEED ^ 0x2b7e1516);
    const eligible = dataset.ap
      .filter((c) => !isV1(c) && !c.invoice.multiPage && !c.exception?.startsWith("bank_detail_mismatch"))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(rng2() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
    }
    for (const c of eligible.slice(0, counts.v2scan ?? 25)) {
      scanSet.add(c.id);
      if (poorSet.size < (counts.v2poor ?? 10)) poorSet.add(c.id);
    }
    for (const c of eligible.slice(counts.v2scan ?? 25, (counts.v2scan ?? 25) + (counts.v2xml ?? 25)))
      xmlSet.add(c.id);
  }

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
      const poor = poorSet.has(chain.id);
      // committed scans are not re-rendered (Chromium stamps metadata, so a
      // re-render churns identical-looking binaries in git)
      if (!existsSync(path.join(seedDir, alt)))
        await renderScanPdf(pg, apInvoiceHtml(chain, sup.name), path.join(seedDir, alt), poor ? "poor" : "normal");
      chain.invoice.format = "scan_pdf";
      chain.invoice.altFile = alt;
      if (poor) chain.invoice.scanQuality = "poor";
      else delete chain.invoice.scanQuality;
      nScan++;
      if (nScan % 10 === 0) console.log(`rendered ${nScan} scan PDFs…`);
    } else if (chain.invoice.format) {
      delete chain.invoice.format;
      delete chain.invoice.altFile;
      delete chain.invoice.scanQuality;
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
    if (!existsSync(path.join(seedDir, inv.file)))
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
