# Bill Reader

Reads a supplier bill (phone photo, scan, or PDF) and turns it into structured
data: supplier, GSTIN, invoice number/date, IRN, and every item line (description,
HSN, qty, rate, rate incl. tax, GST %, amount), then checks the arithmetic.

It replaces `parse_bill.py`. Same idea (OCR words with positions → columns →
qty × rate checks), but it finds the columns from the **heading text** on each bill
instead of fixed pixel ranges, so zoom, crop, and different phones don't break it.
The Python scripts are left in the repo untouched.

## How it works

```
photo / scan ──▶ Tesseract OCR (sparse-text mode) ──┐
digital PDF ───▶ pdf.js text (exact, no OCR) ───────┼──▶ words + positions
scanned PDF ───▶ render page ──▶ Tesseract OCR ─────┘          │
                                                                ▼
                                                     parseBill()
   1. group words into rows
   2. find the table heading (Description · HSN · Qty · Rate · Rate (incl. of Tax) · per · Amount)
      and use the heading positions as column guides
   3. rows with a qty and an amount = items; text-only rows below = rest of the description
   4. no readable heading? recognise values by shape (8-digit HSN, "2 PCS", money)
      and work out rate vs amount by arithmetic
   5. check every line: qty × rate = amount, rate incl ÷ rate = a GST rate
      → if two numbers agree and one doesn't, the odd one was misread:
        correct it and say so ("fixed: …"); otherwise flag the line
   6. read totals (qty, sub-total, CGST, SGST, IGST, round-off, grand total) and cross-check
                                                                ▼
                                    ParsedBill  (lib/bill-reader/types.ts)
```

Why Tesseract and not PaddleOCR (what RapidOCR uses): on the sample bills both
read the item rows, but PaddleOCR returned each table row as one piece with spaces
dropped ("BlueStar 1.5TonAC"), losing the columns. Tesseract returns each word
with its position. Tesseract's default page mode skipped tables with grid lines,
so the **sparse-text** mode is required (`ocr-tesseract.ts`).

## Files

| File | What it does |
|---|---|
| `lib/bill-reader/types.ts` | Data shapes: `OcrWord`, `OcrPage`, `BillLine`, `ParsedBill` |
| `lib/bill-reader/parse-bill.ts` | `parseBill(pages)`: the main logic (steps 1–6 above) |
| `lib/bill-reader/layout.ts` | Rows, heading detection, column boundaries |
| `lib/bill-reader/numbers.ts` | Indian amounts (`2,59,110.00`), qty + unit, GST rates |
| `lib/bill-reader/header-fields.ts` | Supplier/buyer, GSTIN (with check digit), invoice no., date, IRN |
| `lib/bill-reader/product-hints.ts` | Brand / category / size / model guesses for matching |
| `lib/bill-reader/ocr-tesseract.ts` | OCR engine wrapper (works in browser and Node) |
| `lib/bill-reader/pdf.ts` | Turns pdf.js text into words; detects scanned pages |
| `lib/bill-reader/__tests__/bill-reader.test.ts` | Unit tests (hand-built bills, no OCR) |
| `scripts/test-bills.ts` | Reads a folder of bills and prints a report |

Everything in `lib/bill-reader` runs in both the browser and Node. The app will
use the same parser later.

## Run it on real bills

Needs Node 20+ and internet on the first run (downloads the ~5 MB English OCR model
into `node_modules/.cache/bill-reader`).

```powershell
cd <path-to>\parmod-traders
npm install
npm test                                   # 14 unit tests, should all pass
npm run bills:read -- "D:\bills\real"      # any folder of .jpg/.png/.webp/.tif/.pdf
```

`npm run bills:read` with no folder reads `.\testbill` (already git-ignored, so bill
images are never committed). Add `--verbose` to also print the raw OCR rows.

Files and folders starting with `_` are skipped.

### What to send back

For each bill the script writes, next to the bills:

- `results\<bill>.json`: what was parsed
- `results\<bill>.ocr.json`: the raw OCR words (lets the parser be fixed without the photo)

Send the whole `results` folder and the console output. These contain real bill
data (GSTINs, amounts), so share them privately.

### Measuring accuracy (optional, recommended for 3–5 bills)

Put a `<bill>.expected.json` next to a bill with what is actually printed on it.
The script then prints a score and lists every wrong field. Any field can be left out.

```json
{
  "header": {
    "supplierName": "JINDAL ELECTRONICS",
    "supplierGstin": "06AAPFJ7674N1ZF",
    "invoiceNumber": "26-27/7001",
    "invoiceDate": "2026-11-15"
  },
  "lines": [
    { "description": "Godrej 7 Kg Fully Automatic Top Load WM", "hsn": "84501100",
      "quantity": 2, "rateExclTax": 15000, "rateInclTax": 17700, "amount": 30000 }
  ],
  "totals": { "totalQuantity": 4, "subtotal": 76610.17, "cgst": 6894.92, "sgst": 6894.92, "grandTotal": 90400 }
}
```

## Reading the report

```
#   Description             HSN        Qty   Rate       Rate+Tax   GST  Amount     Notes
2   Smart Watch             91021200   10 PCS 2,500.00  2,950.00   18%  29,500.00  fixed: amount 500.00 → 29,500.00 (taxable + 18% GST)
6   LED Bulb 9W             85395200   ? PCS  …                                    Quantity not read
  ✔ Grand total: sub-total + tax = 80,664.80, bill says 80,664.80
  ! SGST 26,152.40 read as 6,152.40 (₹ sign misread as a digit)
```

- **OK**: every number on the line agrees.
- **fixed: …**: one number was misread, and the others agree on what it must be. The
  correction is applied and shown. The app will show these to the owner too.
- **Flag** (e.g. `Quantity not read`, `qty × rate ≠ amount`): the reader couldn't
  confirm the line. The owner must check it in the review screen.
- **✔ / ✘ checks**: bill-level totals. A ✘ can mean an OCR misread *or* a bill that
  really doesn't add up.
- **!**: warnings, e.g. a GSTIN that fails its check digit (a misread character, or a
  typo on the bill).

## Results on the sample bills (2026-11-21)

The samples in `testbill\` are **generated test images, not real bills**. Several
don't add up themselves (e.g. "Total 5 PCS" over lines adding to 6), and the reader
correctly flags those.

| Bill | Fields correct |
|---|---|
| test_invoice_01.png | 33 / 33 |
| test_invoice_05.png | 38 / 38 |
| Home Appliance Tax Invoice.png (Jindal format) | 34 / 35: one IRN character misread |
| collage-gst-5.png (cut from a collage, ~500 px wide) | 30 / 32: "6866" for "6666", smudged CGST |
| sample-text-bill.pdf (digital PDF, Tally format) | 32 / 32 in 0.1 s |
| sample-scanned-bill.pdf (image inside a PDF) | 38 / 38 |

Speed: about 2–8 s per photo on a laptop, about 0.1 s for a digital PDF.

**Still unknown: accuracy on real phone photos.** Real photos have shadows, folds,
tilt and blur that the generated images don't. That is what this run on real bills
is for.

## Known limits

- Photos should be roughly straight and the whole table visible. A strong tilt or
  a folded page will lose rows (they get flagged, not invented).
- Very small images (under ~1,300 px on the long side) are enlarged before OCR, but
  accuracy drops (see the collage crops).
- Handwriting and stamps are not read.
- Multi-page bills: lines from all pages are joined, header from page 1, totals from
  the last page that has them.

## Next (not built yet)

1. "Read bill" button in the app: runs this reader in the browser on an uploaded bill
   and saves the lines to `bill_lines` (status → `extracted`).
2. Review screen: bill photo next to the lines; match each line to a product
   (remembered supplier matches first, then model number) or create a new one.
3. Confirm: one all-or-nothing database function that adds the stock
   (`inventory_movements` reason `purchase_bill`), updates purchase prices (incl. and
   excl. tax), remembers the matches, and marks the bill `confirmed`.
