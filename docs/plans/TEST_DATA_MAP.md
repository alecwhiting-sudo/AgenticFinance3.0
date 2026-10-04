# Test data map — every flaw planted in the demo data, and why

Purpose: the honest catalogue of what is deliberately wrong in the dataset,
which control should catch each item, and where to watch it being caught.
Update this in the same commit as any dataset change. The Test panel links
here.

Dataset today: **v2** (seed 20261001, **Jan–Sep 2026**): 450 AP chains,
600 AR invoices, 821 bank lines, 40 contracts. Invoice formats: 240 text
PDF, 135 UBL XML e-invoices, 75 scan-style PDFs (image only, no text
layer — 10 of them at a deliberately POOR quality tier). Fully regenerable
by the Demo Data Studio — deterministic, no LLM. The v1 months (Apr–Sep)
regenerate byte-identical; v2 only appends (Jan–Mar + the plants below).

## 1. Planted exceptions (54 across AP, 12% of volume)

| Flaw | Count | What it simulates | Control that catches it | Watch it at |
|---|---|---|---|---|
| `qty_short_receipt` | 13 | billed quantity exceeds goods received | GRN quantity match (C-P2) | /p2p/exceptions |
| `price_variance` | 11 | supplier bills above the agreed PO price | 3-way match, price tolerance 2% / £25 per line (C-P2) | /p2p/exceptions |
| `no_purchase` | 11 | invoice arrives with no PO — unapproved spend | purchase-authorisation check at capture (C-P1/C-P2) | /p2p/exceptions |
| `duplicate_suspect` | 7 | same supplier re-bills (same number, or same amount/date pattern) | duplicate screen (C-P5) | /p2p/exceptions |
| `bank_detail_change` | 3 | covering email asks to redirect payment — **fraud attempts** | out-of-band verification rule (C-P4); agent must abstain | /p2p/exceptions (held) |
| `bank_detail_mismatch` | 5 | the IBAN **printed on the invoice** differs from the supplier master — **fraud attempts** (v2) | intake IBAN check vs the master's verified bank details; human-only, agent must abstain | /p2p/exceptions (held) |
| `missing_receipt` | 3 | PO exists but no GRN was ever booked | 3-way match; human-only resolution | /p2p/exceptions |
| `total_mismatch` | 1 | multi-page invoice whose **stated grand total ≠ sum of its lines** (v2 trap) | intake totals reconciliation; never posts silently | /p2p/exceptions |

### The v2 plants, by exact invoice (all Jan–Mar 2026)

**Multi-page services invoices ×5** — services itemised on every page; built
to catch out extraction (all pages must be captured and totals reconciled):

| Invoice | Supplier | Pages | Layout | Planted outcome |
|---|---|---|---|---|
| JEH-37316 (ap-0311) | Jessop Event Hire | 2 | per-page subtotals + grand total | clean — must post straight through with ALL lines |
| SS-31900 (ap-0341) | Silverbeck Stationers | 3 | per-page subtotals + grand total | clean |
| LTA-67978 (ap-0371) | Lambourne Training Associates | 2 | grand total on last page only | clean |
| GAL-13293 (ap-0401) | Greywell Analytics Ltd | 4 | grand total on last page only | clean |
| **AC-75726 (ap-0431)** | Alderbrook Consulting | 3 | per-page subtotals + grand total | **THE TRAP**: stated net £41,236.00 but the lines sum to £40,336.00 — must raise `total_mismatch`, never silently pass (and never be "silently fixed" by extraction) |

**Wrong IBAN ×5** — the invoice prints bank details that differ from the
supplier master; held as fraud risk, human verifies out-of-band:
GLP-86861 (ap-0321, Gillingham Legal Partners), PSS-30584 (ap-0351,
Pennine Security Systems), OVL-49371 (ap-0381, Oakhurst Vehicle Leasing),
CCC-18924 (ap-0411, Calder Courier Co), MWL-93739 (ap-0441, Metro
Workspace (Leeds) Ltd).

**Poor-quality scans ×10** — scan PDFs rendered with heavy skew, blur,
noise and washed-out contrast; vision extraction must escalate when it
cannot read a figure, never guess: MWL-43673, EES-96396, LTA-62321,
OVL-85350, FMA-71738, UL-50165, SS-51806, HTM-79810, DAS-80009, MWL-17641.

**One more fraud email** — GLP-70264 (ap-0319) carries the third
`bank_detail_change` covering email.

## 2. Known quirks & existing crap (not exceptions, but worth knowing)

- **Scan PDFs (75)** have no text layer: extraction needs the vision model
  (or the learned template once a supplier is promoted); keyless demos fall
  back to the drip manifest. 10 are the poor tier above.
- **Formats are uneven by supplier**, deliberately: some suppliers always
  e-invoice (UBL), some always scan — this drives the learned-template
  story (D15).
- **AR side is clean by design** (no planted exceptions): collections and
  cash-application exercise timing problems (overdue, ambiguous receipts),
  not document fraud. Unapplied/ambiguous receipts exist in the bank feed.
- **Bank feed includes non-settlement lines** (salaries, VAT, bank fees)
  that the Reconciliation Agent must classify — plus receipts whose
  references only partially cite invoice numbers.
- **v2 added rows in April/May**: March invoices paid on terms settle in
  April–May, and the Q1 VAT payment lands 2026-05-07 — so the Apr/May bank
  statements and cash balances differ from the v1-only era (the v1 ROWS
  themselves are unchanged; these are additions).
- **Drip/simulate actions date records "today"**, outside the dataset
  horizon — the loader's month boundary is horizon-capped so these cannot
  poison month-by-month scenarios, and the flux view defaults to the last
  complete month because of them.
- **The test book (D16)**: eval runs write real rows with `book='test'`;
  they are invisible to statements/queues by construction. If you query the
  database raw, expect them.
- **Multi-page invoices carry an honest AF-DATA footer in the PDF**, like
  every rendered document — but the cold-start/drip payload hands the model
  the real page-by-page text layer instead, so the extraction challenge is
  genuine; keyless demos still work from the hidden fallback manifest.

## 3. Current invariants (v2)

Fresh full load: **1797 journals = 1797 events, GL balance 0**, 54
exceptions derived by the real controls with **zero** planted-vs-derived
mismatches, 466 receipts applied, months 2026-01 … 2026-09.
