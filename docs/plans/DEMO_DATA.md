# Demo Data Studio — Transaction Generator Agent plan

**Status:** v1 built 2026-10-01 (deterministic pipelines; LLM enrichment pending API key) ·
**Builds in:** Phase 1 (framework proof + P2P dataset), extended each phase ·
**Architecture:** `../ARCHITECTURE.md` §6b

## Purpose

Manufacture Brightline Ltd's business at demo scale: correlated transactions
for P2P, O2C and R2R with believable evidence, at a volume that makes the
agents look busy and capable without meaningful LLM or storage cost.

## Agent identity

- **Name:** Transaction Generator Agent ("the Studio")
- **Work class:** non-financial; writes only to seed/staging tables and the
  document store — it has **no command-gateway authority** over the ledger.
  Seeded business records enter the ERP through the same deterministic intake
  services real records would use.
- **Skills (versioned like any agent):** company story & tone; supplier/
  customer persona generation; transaction weaving (PO→receipt→invoice→email
  chains); exception planting; document copywriting (emails, contracts).

## Two-stage pipeline

1. **Generate (LLM, one-off per dataset):** batched structured-JSON output
   (25–50 records/call, cheap model profile) → committed under
   `packages/db/seed/generated/`. Re-run only from the workbench Admin area.
2. **Render (deterministic, free):** HTML→PDF templates (3–4 invoice/PO/
   contract designs with per-supplier branding), `.eml` emails, CSV bank
   statements → committed under `packages/db/seed/documents/`.

## Dataset targets (initial)

| Artefact | Volume (6 months) |
|---|---|
| Suppliers / customers / items | 40 / 60 / 80 |
| AP: PO → receipt → invoice chains | ~300 invoices |
| AR: orders, contracts, invoices, remittances | ~400 invoices |
| Bank statement lines | ~900 |
| Emails (covering notes, queries, disputes) | ~250 |
| Planted exceptions | 12–15% of flows, covering the full known-exception taxonomy per process plan |
| Daily drip | 10–20 fresh items/day while demoing |

Books must balance: generator evals assert trial-balance integrity, AP/AR
subledger-to-GL agreement, exception quotas met, document↔record linkage
complete.

## Evidence types by process

- **P2P:** PO PDFs, GRNs, supplier invoice PDFs (varied layouts/quality),
  supplier emails, statements.
- **O2C:** contracts/sales agreements, sales orders, AR invoice PDFs,
  remittance advices, customer dispute emails.
- **R2R:** bank statements (CSV + PDF), accrual support schedules, prior-close
  checklists.

## Cost & storage guardrails

- One dataset build ≈ tens of LLM calls → single-digit £; rendering free.
- ~800–1,000 small PDFs ≈ 40–60 MB, committed to the repo, served from the
  Railway container's filesystem (decision D10). Threshold to revisit: repo
  binaries > 250 MB → git LFS or Railway volume.
- `pnpm seed:reset` rebuilds the database from committed JSON/documents with
  zero LLM calls.

## Open items (finalise at Phase 1 start)

- Exact exception taxonomy per process (comes from each process plan).
- Invoice template designs (want 1–2 deliberately "scrappy" layouts to make
  extraction look hard).
- Drip scheduling mechanics (cron work item vs manual "advance a day" button —
  leaning button: more control mid-demo).
