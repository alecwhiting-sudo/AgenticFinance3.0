/** Rendering stage: dataset JSON → PDFs (Chromium via playwright-core),
 * .eml emails and bank statement CSVs under packages/db/seed/. Free and
 * reproducible — no LLM, no network. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import type { Dataset } from "./types.js";
import { apInvoiceHtml, arInvoiceHtml, contractHtml, poHtml, remittanceHtml } from "./templates.js";

function chromiumPath(): string {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error(
    "No Chromium found. Set CHROMIUM_PATH to a Chromium binary (or `npx playwright install chromium` and point CHROMIUM_PATH at it).",
  );
}

export async function render(
  seedDir: string,
  opts: { onlyMissing?: boolean } = {},
): Promise<void> {
  const dataset: Dataset = JSON.parse(
    readFileSync(path.join(seedDir, "generated/dataset.json"), "utf8"),
  );
  const supplierName = new Map(dataset.suppliers.map((s) => [s.code, s.name]));
  const customerName = new Map(dataset.customers.map((c) => [c.code, c.name]));

  for (const d of ["ap", "po", "ar", "contracts", "remittances", "emails", "bank"])
    mkdirSync(path.join(seedDir, "documents", d), { recursive: true });

  const browser: Browser = await chromium.launch({ executablePath: chromiumPath() });
  const pg: Page = await browser.newPage();
  let n = 0;
  const pdf = async (relFile: string, html: string) => {
    const out = path.join(seedDir, relFile);
    // --missing: committed documents are never re-rendered (Chromium stamps
    // metadata into PDFs, so a re-render churns v1 binaries in git)
    if (opts.onlyMissing && existsSync(out)) return;
    await pg.setContent(html, { waitUntil: "load" });
    await pg.pdf({ path: out, format: "A4", printBackground: true });
    if (++n % 100 === 0) console.log(`rendered ${n} PDFs…`);
  };

  const renderedContracts = new Set<string>();
  for (const chain of dataset.ap) {
    const sName = supplierName.get(chain.supplierCode) ?? chain.supplierCode;
    await pdf(chain.invoice.file, apInvoiceHtml(chain, sName));
    if (chain.po) await pdf(chain.po.file, poHtml(chain, sName));
    const e = chain.email;
    writeFileSync(
      path.join(seedDir, e.file),
      `From: ${sName} <${e.from}>\r\nTo: accounts@brightline.example\r\nDate: ${e.date}\r\nSubject: ${e.subject}\r\nX-Attachment: ${path.basename(chain.invoice.file)}\r\n\r\n${e.body}\r\n`,
    );
  }
  for (const inv of dataset.ar) {
    const cName = customerName.get(inv.customerCode) ?? inv.customerCode;
    await pdf(inv.file, arInvoiceHtml(inv, cName));
    if (inv.contractFile && !renderedContracts.has(inv.contractFile)) {
      renderedContracts.add(inv.contractFile);
      await pdf(inv.contractFile, contractHtml(cName, inv.customerCode, dataset.meta.from));
    }
    if (inv.remittanceFile) await pdf(inv.remittanceFile, remittanceHtml(inv, cName));
  }
  await browser.close();

  // bank statements: one CSV per month plus a combined file
  const byMonth = new Map<string, string[]>();
  const header = "date,amount,reference,counterparty,kind";
  for (const t of dataset.bank) {
    const key = t.date.slice(0, 7);
    const row = `${t.date},${(t.amountMinor / 100).toFixed(2)},${t.reference},"${t.counterparty}",${t.kind}`;
    byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
  }
  const all: string[] = [header];
  for (const [month, rows] of [...byMonth.entries()].sort()) {
    writeFileSync(path.join(seedDir, `documents/bank/statement-${month}.csv`), [header, ...rows].join("\n") + "\n");
    all.push(...rows);
  }
  writeFileSync(path.join(seedDir, "documents/bank/statement-all.csv"), all.join("\n") + "\n");

  console.log(
    `rendered ${n} PDFs, ${dataset.ap.length} emails, ${byMonth.size + 1} bank CSVs into ${path.join(seedDir, "documents")}`,
  );
}
