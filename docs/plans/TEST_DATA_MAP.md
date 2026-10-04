# Test data map — every flaw planted in the demo data, and why

Purpose: the honest catalogue of what is deliberately wrong in the dataset,
which control should catch each item, and where to watch it being caught.
Update this in the same commit as any dataset change. The Test panel links
here (and will render the live counts once dataset v2 lands).

Dataset today: **v1** (seed 20261001, Apr–Sep 2026): 300 AP chains,
400 AR invoices, 508 bank lines, 40 contracts. Invoice formats: 140 text
PDF, 110 UBL XML e-invoices, 50 scan-style PDFs (image only, no text
layer). Fully regenerable by the Demo Data Studio — deterministic, no LLM.

## 1. Planted exceptions (v1 — 36 across AP, ~12% of volume)

| Flaw | Count | What it simulates | Control that catches it | Watch it at |
|---|---|---|---|---|
| `price_variance` | 10 | supplier bills above the agreed PO price | 3-way match, price tolerance 2% / £25 per line (C-P2) | /p2p/exceptions |
| `no_purchase` | 9 | invoice arrives with no PO — unapproved spend | purchase-authorisation check at capture (C-P1/C-P2) | /p2p/exceptions |
| `qty_short_receipt` | 7 | billed quantity exceeds goods received | GRN quantity match (C-P2) | /p2p/exceptions |
| `duplicate_suspect` | 5 | same supplier re-bills (same number, or same amount/date pattern) | duplicate screen (C-P5) | /p2p/exceptions |
| `missing_receipt` | 3 | PO exists but no GRN was ever booked | 3-way match; human-only resolution | /p2p/exceptions |
| `bank_detail_change` | 2 | covering email asks to redirect payment — **fraud attempts** | out-of-band verification rule (C-P4); agent must abstain | /p2p/exceptions (held) |

## 2. Known quirks & existing crap (not exceptions, but worth knowing)

- **Scan PDFs (50)** have no text layer: extraction needs the vision model
  (or the learned template once a supplier is promoted); keyless demos fall
  back to the drip manifest. Quality is uniform — v2 adds genuinely poor
  tiers.
- **Formats are uneven by supplier**, deliberately: some suppliers always
  e-invoice (UBL), some always scan — this drives the learned-template
  story (D15).
- **AR side is clean by design** (no planted exceptions): collections and
  cash-application exercise timing problems (overdue, ambiguous receipts),
  not document fraud. Unapplied/ambiguous receipts exist in the bank feed.
- **Bank feed includes non-settlement lines** (salaries, VAT, bank fees)
  that the Reconciliation Agent must classify — plus receipts whose
  references only partially cite invoice numbers.
- **Drip/simulate actions date records "today"**, outside the dataset
  horizon — the loader's month boundary is horizon-capped so these cannot
  poison month-by-month scenarios, and the flux view defaults to the last
  complete month because of them.
- **The test book (D16)**: eval runs write real rows with `book='test'`;
  they are invisible to statements/queues by construction. If you query the
  database raw, expect them.
- **Supplier master has no bank details yet** — which is why the only
  IBAN-style fraud v1 can stage is the email-based `bank_detail_change`.
  v2 fixes this (see below).

## 3. Planned additions (dataset v2 — plans/DATASET_V2.md PR-C)

To be listed here with exact invoice numbers once generated:

| Planned flaw | Spec | Control exercised |
|---|---|---|
| Multi-page invoices ×5 | services itemised across 2–4 pages; **2 with per-page subtotals + grand total**, **2 with grand total only on the last page**, **1 with a per-page subtotal that does NOT sum to the stated grand total** (the trap) | extraction completeness: all lines captured, totals reconciled to lines; the trap must raise an exception, never silently pass |
| Incorrect IBAN ×4–6 | invoice IBAN differs from supplier master bank details (new master-data field) | new intake check `bank_detail_mismatch` — held like C-P4, out-of-band verification |
| Poor-quality scans | a low-quality tier (skew/noise/low contrast) on ~10 of the scan PDFs | vision extraction robustness; failures must escalate, not guess |
| Jan–Mar volume | three more months of ordinary chains + the same exception taxonomy pro-rata | everything, at 9-month scale |

Existing v1 planted items stay unchanged so current demos keep working.
