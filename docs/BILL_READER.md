# Bill Reader

Reads a supplier bill (phone photo, scan, or PDF) **inside the app, on the phone**
(free — Tesseract OCR in the browser, nothing sent to an AI service), shows each
step live, lets the owner review, and adds the stock in one all-or-nothing step.

## What the owner sees

```
Upload bill ──▶ 1. Reading the image      which way up, how big the text is
                2. Extracting the text    OCR, then the item table again, zoomed in
                3. Understanding the bill columns, qty × rate = amount, GST, totals
                4. Saving to database     lines saved for review (status "extracted")
            ──▶ Review & add to stock     fix anything yellow, pick / create products
                1. Checking the lines
                2. Adding to stock        one database transaction
```

If a step fails, **only that step turns red**, with the reason and a "Try again" that
continues from that step. In the review, a line with a problem (missing quantity,
duplicate model number…) is outlined red with the reason; nothing is saved until
every line is fine.

## Setup (once)

Run in the Supabase SQL editor, in order:

1. `supabase/migrations/011_require_login_for_reads.sql` (login required to read data)
2. `supabase/migrations/012_bill_reading_and_confirm.sql` (bill reading + add to stock)

Both are safe to run twice. 012 was tested on a local PostgreSQL with all migrations
001–012 (save, re-read, duplicate e-invoice, missing quantity → nothing changed,
confirm, confirm twice refused, staff refused).

The shop's GSTIN is in `lib/shop-config.ts` (override with `NEXT_PUBLIC_SHOP_GSTIN`).
The reader uses it so the shop (the buyer on every bill) is never taken as the supplier.

## How it reads a photo

| Problem on real phone photos | What the reader does | File |
|---|---|---|
| Photo sideways / upside down | OCR at 0°, 180°, 90°, 270° until one reads well | `pipeline.ts` |
| WhatsApp shrinks to 1200×1600 → table text 6–11 px | Measure text height, enlarge so text ≈ 24 px | `pipeline.ts` |
| Table text is the smallest on the page | Read the table strip again at ≈ 36 px; keep whichever read checks out (items and totals chosen separately) | `pipeline.ts`, `read-bill.ts` |
| Page tilted / curled / shot at an angle → amounts a row off | Find the smooth shift that lines the words up into rows, subtract it | `straighten.ts` |
| Numbers damaged: `1220000`, `10 300 00`, `20.762.71`, `X1,120.50` | Bills print paise → put the separators back; ₹ misread as X / ¥ | `numbers.ts` |
| One number on a line misread | Every number votes for the line's before-tax value under each role it could have (rate, rate incl. tax, amount, taxable, CGST/SGST, total); the reading most numbers agree on wins, the odd ones are corrected and reported ("fixed: …") | `line-solver.ts` |
| `200 PCS` = 2.00 PCS, `g4182100` = 84182100 | Quantity / HSN repair, checked by the arithmetic | `line-solver.ts`, `table.ts` |
| Different layouts (Jindal / Tally, Ahujas / LG with per-line CGST/SGST, Batch rows) | Headings only *suggest* roles; arithmetic decides | `table.ts`, `layout.ts` |
| One line unreadable | Sub-total − other lines | `parse-bill.ts` |
| Supplier name / GSTIN half-read | Check-digit-guided GSTIN repair; suppliers already in the app recognised from fragments | `header-fields.ts` |

Digital PDFs are read from their text layer (exact, ~0.1 s). Photos inside PDFs are
rendered at the photo's own resolution and read like photos.

## Files

| File | What it does |
|---|---|
| `lib/bill-reader/read-bill.ts` | The steps (prepare → extract + zoom → understand). Used by the app **and** the test script |
| `lib/bill-reader/browser.ts` | Browser only: photos/PDFs → pages, Tesseract in a web worker |
| `lib/bill-reader/pipeline.ts` | Which way up, text size, zoomed table read |
| `lib/bill-reader/image.ts` | Grey / rotate / resize / crop (same code in browser and Node) |
| `lib/bill-reader/straighten.ts` | Page straightening |
| `lib/bill-reader/parse-bill.ts` | `parseBill(pages, options)`: table, totals, bill-level checks |
| `lib/bill-reader/table.ts` | Table rows → serial, description, HSN, qty, numbers |
| `lib/bill-reader/line-solver.ts` | The arithmetic that fixes misread numbers |
| `lib/bill-reader/header-fields.ts` | Supplier, GSTIN, invoice no./date, IRN |
| `lib/bill-reader/match.ts` | Bill line → product (supplier memory, model number, suggestions) |
| `lib/services/bill-reading-service.ts` | Save reading, load lines, add to stock (database functions in migration 012) |
| `components/bills/BillReaderModal.tsx` | The 4 live steps |
| `components/bills/BillReviewModal.tsx` | Review & add to stock |
| `scripts/test-bills.ts` | Reads a folder of bills, prints a report and a score |

## Test on real bills (laptop)

```powershell
cd <path-to>\parmod-traders
npm install
npm test                                        # 21 unit tests
npm run bills:read -- "D:\bills\real"           # .jpg .png .webp .pdf …
npm run bills:read -- "D:\bills\real" --cached  # re-parse saved OCR (seconds; for parser work)
```

Optional files in the bills folder (names starting with `_` are not read as bills):

- `_config.json` — what the app knows: `{ "ownGstin": "06…", "knownSuppliers": [{ "name": "…", "gstin": "…" }] }`
- `<bill>.expected.json` — what is printed on the bill; the script prints a score
  (descriptions count as right at ≥ 90 % the same, so one misread letter is OK).

Results go to `<folder>\results\` (`<bill>.json`, `<bill>.ocr.json`). They contain real
bill data — share privately.

## Results (2026-11-22)

Five **real** bills (WhatsApp photos, one photo-in-PDF), with the shop GSTIN and the two
suppliers known (as in the app after their first bill):

| Bill | Photo | Fields correct |
|---|---|---|
| Jindal 4-Nov | on a table, tilted, newspaper around | 61 / 64 |
| Jindal 21-Nov (PDF) | bill fills half the photo, text 8 px | 81 / 85 |
| Ahujas 16-Sep | sideways, held in hand | 31 / 35 |
| Ahujas 1-Oct | upside down | 22 / 25 |
| Jindal 1-Oct | held in hand, page curled at the bottom | 31 / 60 |
| **All** | | **226 / 269 (84 %)** |

Before this work the same five bills gave 0 item lines. Generated sample images:
200 / 208. Speed on a laptop: 10–35 s per photo; phones will be slower.

The browser path was run in Edge (headless) on two of the real bills: same results as
Node for the Ahujas photo; for the PDF the browser renders slightly different pixels, so
OCR results differ a little (11 lines found, totals missed in that run).

## Known limits

- Photos held in the hand with the page curling away (Jindal 1-Oct) lose the bottom rows.
- WhatsApp-forwarded photos are 1200×1600; the original camera photo or the supplier's PDF
  reads much better.
- Multi-page bills: add every page to the same upload; lines from all pages are joined,
  totals come from the last page that has them.
- Handwriting and stamps are not read.
- Not yet tested end-to-end in the deployed app with a real owner login (the database
  functions and the browser reader were tested separately — see above).
