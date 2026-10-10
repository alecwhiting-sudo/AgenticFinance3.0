# @af/studio — Demo Data Studio

The Transaction Generator Agent's pipelines (ARCHITECTURE.md §6b,
docs/plans/DEMO_DATA.md): manufactures Brightline Services plc's 6 months of
correlated P2P/O2C/R2R history and evidence documents, deterministically and
for free — no LLM calls, reproducible from a seed.

```bash
pnpm studio:generate [seed]   # -> packages/db/seed/generated/dataset.json
pnpm studio:render            # -> packages/db/seed/documents/** (PDF/eml/CSV)
pnpm studio:validate          # invariants: arithmetic, quotas, linkage, bank
pnpm studio:drip              # stub — lands with P2P milestone M5
```

What a dataset contains: suppliers/customers/items, ~300 AP chains
(PO → GRN → invoice PDF + covering email), ~400 AR invoices (+ 40 contracts,
remittances), a full bank feed (payments, receipts, payroll, VAT, fees), and
12–15% planted exceptions from the P2P taxonomy — including exactly two
`bank_detail_change` fraud attempts for the security demo moment.

Every rendered PDF carries a tiny grey `AF-DATA {json}` footer: a real text
layer the keyless deterministic extraction path can parse, so the whole P2P
demo works without an API key. The Invoice Extraction Agent's LLM mode reads
the human-visible layout instead.

Rendering uses Chromium via playwright-core: set `CHROMIUM_PATH` if the binary
isn't at `/opt/pw-browsers/chromium` (`npx playwright install chromium` gets
one). Generated JSON + documents are committed (decision D10) so `seed:reset`
and Railway deploys never regenerate or re-render anything.

LLM enrichment (varying email/contract prose via the Anthropic API) is a
planned release change to the Transaction Generator Agent once an
`ANTHROPIC_API_KEY` is configured — the deterministic pipeline stays the
source of record either way.
