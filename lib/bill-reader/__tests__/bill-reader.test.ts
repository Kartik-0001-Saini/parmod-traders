/**
 * Unit tests for the Bill Reader parser (no OCR involved — words are built by hand).
 * Run:  npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBill } from "../parse-bill";
import { parseAmount, parseLooseMoney, parseQuantityWithUnit, inferGstRate } from "../numbers";
import { gstinChecksumOk, normalizeGstin, parseDate } from "../header-fields";
import { productHints } from "../product-hints";
import { solveLine } from "../line-solver";
import { cleanHsn } from "../table";
import { straighten } from "../straighten";
import { groupRows } from "../layout";
import { matchByModel, CatalogItem } from "../match";
import type { OcrPage, OcrWord } from "../types";

const H = 20;
/** A word at (x, y); width ≈ 10 px per character. */
const w = (text: string, x: number, y: number): OcrWord => ({ text, conf: 95, x0: x, y0: y, x1: x + text.length * 10, y1: y + H });
const page = (words: OcrWord[]): OcrPage => ({ words, width: 1200, height: 1600, source: "ocr" });
const line = (y: number, ...parts: [string, number][]) => parts.map(([t, x]) => w(t, x, y));

// ---------------------------------------------------------------------------
// Numbers, GSTIN, dates
// ---------------------------------------------------------------------------

test("parseAmount: Indian and Western grouping, ₹, OCR damage", () => {
  assert.deepEqual(parseAmount("2,59,110.00"), { value: 259110, suspicious: false });
  assert.deepEqual(parseAmount("₹ 1,120.50"), { value: 1120.5, suspicious: false });
  assert.deepEqual(parseAmount("1,800.00/-"), { value: 1800, suspicious: false });
  assert.equal(parseAmount("2,32.00")?.suspicious, true, "impossible grouping = a digit was lost");
  assert.deepEqual(parseAmount("4,25O.00"), { value: 4250, suspicious: true });
  assert.equal(parseAmount("PCS"), null);
});

test("quantities and GST rates", () => {
  assert.deepEqual(parseQuantityWithUnit("2PCS"), { value: 2, unit: "PCS" });
  assert.deepEqual(parseQuantityWithUnit("100 MTR"), { value: 100, unit: "MTR" });
  assert.equal(parseQuantityWithUnit("7Kg Washing"), null);
  assert.equal(inferGstRate(141.6, 120), 18);
  assert.equal(inferGstRate(100.3, 85), 18);
  assert.equal(inferGstRate(112, 100), 12);
  assert.equal(inferGstRate(115, 100), null);
});

test("GSTIN: check digit and OCR fixes", () => {
  assert.equal(gstinChecksumOk("27AAPFU0939F1ZV"), true);
  assert.equal(gstinChecksumOk("27AAPFU0939F1ZW"), false);
  assert.equal(normalizeGstin("O6AAAFJ7674N1ZF"), "06AAAFJ7674N1ZF"); // letter O → zero
  assert.equal(normalizeGstin("06AAAFJ7674N12F"), "06AAAFJ7674N1ZF"); // 2 → Z in the 14th place
  assert.equal(normalizeGstin("HELLO"), null);
});

test("parseDate", () => {
  assert.equal(parseDate("12-Nov-26"), "2026-11-12");
  assert.equal(parseDate("21-Nov-2026"), "2026-11-21");
  assert.equal(parseDate("21/11/2026"), "2026-11-21");
  assert.equal(parseDate("5.3.26"), "2026-03-05");
  assert.equal(parseDate("Invoice"), null);
});

test("product hints", () => {
  assert.deepEqual(productHints("LG 1.5 Ton Split AC"), { brand: "LG", category: "Air Conditioners", sizeSpec: "1.5 Ton", modelCandidate: null });
  assert.equal(productHints("AC Stabilizer 2 KVA").category, "Other Electronics");
  assert.equal(productHints("BlueStar 1.5TonAC").brand, "Blue Star");
  assert.equal(productHints("Samsung Refrigerator 236L RT28").sizeSpec, "236 L");
  assert.equal(productHints("Samsung Refrigerator 236L RT28").modelCandidate, "RT28");
  assert.equal(productHints("LED TV 43 inch").category, "LED TVs");
  assert.equal(productHints("LED Bulb 9W").category, null);
});

// ---------------------------------------------------------------------------
// Tally layout: Rate | Rate (incl. of Tax) | per | Amount, tax lines without labels
// ---------------------------------------------------------------------------

function tallyBill(rateLine1 = "38,135.59"): OcrPage {
  return page([
    ...line(40, ["Tax", 400], ["Invoice", 440]),
    ...line(100, ["JINDAL", 50], ["ELECTRONICS", 120], ["Invoice", 520], ["No.", 600], ["Dated", 820]),
    ...line(130, ["4TH", 50], ["MILL", 100], ["26-27/6821", 520], ["12-Nov-26", 820]),
    ...line(160, ["HISAR", 50]),
    ...line(190, ["GSTIN/UIN", 50], ["06AAAFJ7674N1ZF", 170]),
    ...line(220, ["E-Mail", 50], ["jindal@x.com", 120]),
    ...line(270, ["PARMOD", 50], ["TRADERS", 120], ["LOHARU", 200], ["Buyer's", 520], ["Order", 600], ["No.", 660]),
    ...line(300, ["LOHARU,", 50]),
    // GSTIN far right of its label (Tally pads with spaces)
    ...line(330, ["GSTIN/UIN", 50], [":", 230], ["06BTGPM6651M1Z7", 250]),
    // table heading (two lines)
    ...line(400, ["Sl.", 40], ["Description", 120], ["of", 230], ["Goods", 260], ["HSN/SAC", 480], ["Quantity", 600], ["Rate", 720], ["Rate", 820], ["per", 920], ["Amount", 1000]),
    ...line(425, ["No.", 40], ["(incl.", 800], ["of", 860], ["Tax)", 890]),
    // items
    ...line(470, ["1", 45], ["LG", 120], ["1.5", 150], ["Ton", 190], ["Split", 230], ["AC", 290], ["84151010", 480], ["2", 610], ["PCS", 630], [rateLine1, 700], ["45,000.00", 800], ["PCS", 920], ["76,271.19", 990]),
    ...line(500, ["2", 45], ["Voltas", 120], ["1.5", 190], ["Ton", 230], ["AC", 270], ["84151010", 480], ["1", 610], ["PCS", 630], ["37,711.86", 700], ["44,500.00", 800], ["PCS", 920], ["37,711.86", 990]),
    ...line(525, ["Model", 120], ["185V", 180]),
    // totals
    ...line(580, ["Total", 400], ["3", 610], ["PCS", 630], ["1,13,983.05", 990]),
    ...line(610, ["10,258.47", 990]),
    ...line(640, ["10,258.47", 990]),
    ...line(680, ["Total", 800], ["₹", 960], ["1,34,500.00", 990]),
  ]);
}

test("Tally bill: header, lines, wrapped description, unlabeled CGST/SGST, checks", () => {
  const bill = parseBill([tallyBill()]);
  assert.equal(bill.header.supplierName, "JINDAL ELECTRONICS");
  assert.equal(bill.header.supplierGstin, "06AAAFJ7674N1ZF");
  assert.equal(bill.header.buyerName, "PARMOD TRADERS LOHARU");
  assert.equal(bill.header.buyerGstin, "06BTGPM6651M1Z7", "\"Buyer's Order No.\" is not the buyer block");
  assert.equal(bill.header.invoiceNumber, "26-27/6821");
  assert.equal(bill.header.invoiceDate, "2026-11-12");

  assert.equal(bill.lines.length, 2);
  const [a, b] = bill.lines;
  assert.equal(a.description, "LG 1.5 Ton Split AC");
  assert.equal(a.hsn, "84151010");
  assert.equal(a.quantity, 2);
  assert.equal(a.unit, "PCS");
  assert.equal(a.rateExclTax, 38135.59);
  assert.equal(a.rateInclTax, 45000);
  assert.equal(a.amount, 76271.19);
  assert.equal(a.gstRate, 18);
  assert.equal(a.amountIncludesTax, false);
  assert.deepEqual(a.flags, []);
  assert.equal(b.description, "Voltas 1.5 Ton AC Model 185V", "continuation row joins the description");

  assert.equal(bill.totals.totalQuantity, 3);
  assert.equal(bill.totals.subtotal, 113983.05);
  assert.equal(bill.totals.cgst, 10258.47);
  assert.equal(bill.totals.sgst, 10258.47);
  assert.equal(bill.totals.grandTotal, 134500);
  for (const c of bill.checks) assert.ok(c.ok, `${c.name}: ${c.detail}`);
});

test("Tally bill: misread rate is corrected from amount ÷ qty (same rule as parse_bill.py)", () => {
  const bill = parseBill([tallyBill("33,135.59")]);
  const a = bill.lines[0];
  assert.equal(a.rateExclTax, 38135.6);
  assert.equal(a.autoFixed.length, 1);
  assert.deepEqual(a.flags, []);
});

// ---------------------------------------------------------------------------
// Layout with Taxable + GST % columns (amount includes tax), watermark damage
// ---------------------------------------------------------------------------

test("Taxable/GST% bill: damaged amount fixed, ₹ misread in CGST fixed", () => {
  const bill = parseBill([
    page([
      ...line(400, ["Sl.", 40], ["Description", 120], ["of", 230], ["Goods", 260], ["HSN/SAC", 480], ["Qty", 600], ["Rate", 700], ["(₹)", 750], ["Taxable", 820], ["(₹)", 900], ["GST", 960], ["%", 1000], ["Amount", 1060]),
      ...line(460, ["1", 45], ["LED", 120], ["Bulb", 160], ["9W", 210], ["85395200", 480], ["50", 600], ["PCS", 625], ["85.00", 700], ["4,250.00", 820], ["18%", 960], ["5,015.00", 1060]),
      ...line(500, ["2", 45], ["LED", 120], ["Tube", 160], ["Light", 210], ["20W", 270], ["85395200", 480], ["20", 600], ["PCS", 625], ["120.00", 700], ["2,400.00", 820], ["18%", 960], ["2,", 1060], ["32.00", 1085]),
      ...line(560, ["Taxable", 800], ["Value:", 880], ["₹", 1030], ["6,650.00", 1060]),
      ...line(590, ["CGST", 800], ["@", 860], ["9%:", 880], ["3,598.50", 1060]),
      ...line(620, ["SGST", 800], ["@", 860], ["9%:", 880], ["598.50", 1060]),
      ...line(660, ["GRAND", 800], ["TOTAL:", 880], ["7,847.00", 1060]),
    ]),
  ]);
  assert.equal(bill.lines.length, 2);
  const [a, b] = bill.lines;
  assert.equal(a.taxableValue, 4250);
  assert.equal(a.amount, 5015);
  assert.equal(a.amountIncludesTax, true);
  assert.equal(a.rateInclTax, 100.3);
  assert.equal(b.amount, 2832, "2,32.00 (watermark ate the 8) → taxable + 18%");
  assert.equal(b.autoFixed.length, 1);
  assert.equal(bill.totals.subtotal, 6650);
  assert.equal(bill.totals.cgst, 598.5, "₹ read as 3 → fixed");
  for (const c of bill.checks) assert.ok(c.ok, `${c.name}: ${c.detail}`);
});

// ---------------------------------------------------------------------------
// Regressions found on the sample bills
// ---------------------------------------------------------------------------

test("Centred headings: description text under the 'Sl.' heading is kept", () => {
  const bill = parseBill([
    page([
      ...line(400, ["Sl.", 49], ["Description", 195], ["of", 310], ["Goods", 336], ["HSN/SAC", 493], ["Quantity", 622], ["Rate", 760], ["per", 862], ["Amount", 950]),
      ...line(425, ["No.", 45], ["(incl.", 731], ["of", 795], ["Tax)", 820]),
      ...line(470, ["1", 57], ["LG", 98], ["1.5", 135], ["Ton", 169], ["Split", 215], ["AC", 267], ["84151010", 493], ["2", 636], ["PCS", 650], ["45,000.00", 733], ["PCS", 857], ["90,000.00", 948]),
    ]),
  ]);
  assert.equal(bill.lines[0].description, "LG 1.5 Ton Split AC");
  assert.equal(bill.lines[0].rateInclTax, 45000, "single rate column is '(incl. of Tax)'");
  assert.equal(bill.lines[0].rateExclTax, null);
  assert.equal(bill.lines[0].amountIncludesTax, true);
});

test("Two 'Rate' headings with the '(incl. of Tax)' line unread: GST ratio decides", () => {
  const bill = parseBill([
    page([
      ...line(400, ["Sl.", 20], ["Description", 60], ["HSN/SAC", 245], ["Quantity", 320], ["Rate", 405], ["Rate", 480], ["per", 545], ["Amount", 610]),
      ...line(440, ["1", 22], ["Bluetooth", 40], ["Speaker", 140], ["85182200", 245], ["25", 320], ["PCS", 345], ["1,200.00", 395], ["1,416.00", 470], ["PCS", 545], ["35,400.00", 600]),
    ]),
  ]);
  const l = bill.lines[0];
  assert.equal(l.rateExclTax, 1200);
  assert.equal(l.rateInclTax, 1416);
  assert.equal(l.amount, 35400);
  assert.equal(l.gstRate, 18);
});

test("Supplier / buyer from 'SUPPLIER / SELLER' and 'BUYER / BILL TO' labels", () => {
  const bill = parseBill([
    page([
      ...line(440, ["SUPPLIER", 122], ["/", 259], ["SELLER", 279], ["BUYER", 842], ["/", 934], ["BILL", 958], ["TO", 1022]),
      ...line(487, ["NORTHSTAR", 122], ["TEST", 248], ["ELECTRONICS", 306], ["DEMO", 842], ["RETAILERS", 909]),
      ...line(550, ["GSTIN/UIN:", 842], ["27AAPFU0939F1ZV", 960]),
      ...line(580, ["Invoice", 842], ["No.:", 920], ["TEST/26-27/0001", 970]),
    ]),
  ]);
  assert.equal(bill.header.supplierName, "NORTHSTAR TEST ELECTRONICS");
  assert.equal(bill.header.buyerName, "DEMO RETAILERS");
  assert.equal(bill.header.buyerGstin, "27AAPFU0939F1ZV", "GSTIN under the BUYER label is the buyer's");
  assert.equal(bill.header.supplierGstin, null);
  assert.equal(bill.header.invoiceNumber, "TEST/26-27/0001");
});

test("Long description running into the HSN column, and numbers under the 'Sl.' heading", () => {
  const head = [
    ...line(400, ["Sl.", 20], ["Description", 150], ["of", 265], ["Goods", 290], ["HSN/SAC", 470], ["Quantity", 560], ["Rate", 660], ["Rate", 740], ["per", 870], ["Amount", 940]),
    ...line(425, ["No.", 20], ["(incl.", 720], ["of", 785], ["Tax)", 810]),
  ];
  const bill = parseBill([
    page([
      ...head,
      ...line(470, ["2", 25], ["Samsung", 60], ["236", 140], ["L", 175], ["Refrigerator", 190], ["RT28", 420], ["84182100", 470], ["1", 560], ["PCS", 575], ["21,186.44", 640], ["25,000.00", 730], ["PCS", 870], ["21,186.44", 920]),
      ...line(500, ["3", 25], ["LG", 50], ["43", 80], ["inch", 110], ["Smart", 160], ["LED", 220], ["TV", 260], ["85287217", 470], ["1", 560], ["PCS", 575], ["25,423.73", 640], ["30,000.00", 730], ["PCS", 870], ["25,423.73", 920]),
    ]),
  ]);
  assert.equal(bill.lines[0].description, "Samsung 236 L Refrigerator RT28");
  assert.equal(bill.lines[1].lineNo, 3);
  assert.equal(bill.lines[1].description, "LG 43 inch Smart LED TV");
});

test("Cut-off 'Amount' heading, '35 400.00' split by OCR, GST % misread as 8%", () => {
  const bill = parseBill([
    page([
      ...line(400, ["Sl.", 40], ["Description", 120], ["HSN/SAC", 480], ["Qty", 600], ["Rate", 700], ["Taxable", 820], ["GST", 960], ["%", 1000], ["oun", 1150]),
      ...line(460, ["1", 45], ["Bluetooth", 120], ["Speaker", 220], ["85182100", 480], ["25", 600], ["PCS", 625], ["1,200.00", 700], ["30,000.00", 820], ["18%", 960], ["35", 1140], ["400.00", 1165]),
      ...line(500, ["2", 45], ["Cap", 120], ["65050090", 480], ["30", 600], ["PCS", 625], ["199.00", 700], ["5,970.00", 820], ["8%", 960], ["7,044.60", 1140]),
    ]),
  ]);
  const [a, b] = bill.lines;
  assert.equal(a.amount, 35400, "'35' + '400.00' re-joined, found right of the last heading");
  assert.deepEqual(a.flags, []);
  assert.equal(b.amount, 7044.6, "the printed amount is kept…");
  assert.equal(b.gstRate, 18, "…and the misread 8% is corrected from amount ÷ taxable");
  assert.ok(b.autoFixed.some((f) => f.startsWith("GST 8%")));
});

// ---------------------------------------------------------------------------
// Heading unreadable → values recognised by shape + arithmetic
// ---------------------------------------------------------------------------

test("No readable heading: rate vs amount worked out by arithmetic", () => {
  const bill = parseBill([
    page([
      ...line(400, ["HERass", 40], ["le)", 425], ["Uae", 646], ["lal", 867]),
      ...line(450, ["1", 57], ["LG", 98], ["1.5", 135], ["Ton", 169], ["Split", 215], ["AC", 267], ["84151010", 493], ["2PCS", 636], ["45,000.00", 733], ["PCS", 857], ["90,000.00", 948]),
      ...line(480, ["5", 57], ["AC", 99], ["Stabilizer", 137], ["2", 239], ["KVA", 258], ["85044090", 493], ["1PCS", 637], ["3,200.00", 744], ["PCS", 857], ["3,200.00", 959]),
      ...line(540, ["Total", 421], ["3PCS", 636], ["93,200.00", 919]),
    ]),
  ]);
  assert.equal(bill.lines.length, 2);
  assert.equal(bill.lines[0].rateExclTax, 45000);
  assert.equal(bill.lines[0].amount, 90000);
  assert.equal(bill.lines[1].lineNo, 5);
  assert.equal(bill.lines[1].description, "AC Stabilizer 2 KVA");
  assert.equal(bill.lines[1].hints.category, "Other Electronics");
  assert.ok(bill.warnings.some((x) => /heading not found/.test(x)));
});

// ---------------------------------------------------------------------------
// Real phone photos (WhatsApp, tilted, curved) — cases taken from the real bills
// ---------------------------------------------------------------------------

test("parseLooseMoney: separators lost or misread, as on WhatsApp photos", () => {
  assert.equal(parseLooseMoney("1220000")?.value, 12200, "decimal point lost — bills always print paise");
  assert.ok(parseLooseMoney("1220000")?.alts.includes(1220000));
  assert.equal(parseLooseMoney("10 300 00")?.value, 10300);
  assert.equal(parseLooseMoney("26,101 69")?.value, 26101.69);
  assert.equal(parseLooseMoney("20.762.71")?.value, 20762.71);
  assert.equal(parseLooseMoney("12.627 12PCS")?.value, 12627.12);
  assert.deepEqual(parseLooseMoney("8,305.08)"), { value: 8305.08, alts: [], quality: 1 });
  assert.equal(parseLooseMoney("X1,120.50")?.value, 1120.5, "₹ read as X");
  assert.equal(parseLooseMoney("WTT70DLIM"), null);
  // Two prices glued together ("18.200.00,15.429.79") must never become one huge number.
  assert.equal(parseLooseMoney("18.200.00,15.429.79"), null);
});

test("line solver: '400 PCS' is 4.00 PCS, a misread rate is rebuilt from amount ÷ qty", () => {
  const s = solveLine({
    qty: 400,
    values: [
      { value: 12200, alts: [1220000], quality: 0.6, role: null, text: "1220000", order: 0, count: 3 },
      { value: 10338, alts: [103.38], quality: 0.4, role: null, text: "10,338 us|", order: 1, count: 3 },
      { value: 41355.92, alts: [], quality: 1, role: null, text: "41,355.92", order: 2, count: 3 },
    ],
    percents: [],
  });
  assert.equal(s.quantity, 4);
  assert.equal(s.rateExclTax, 10338.98);
  assert.equal(s.rateInclTax, 12200);
  assert.equal(s.amount, 41355.92);
  assert.equal(s.gstRate, 18);
  assert.ok(s.autoFixed.some((f) => f.startsWith("quantity 400 → 4")));
  assert.deepEqual(s.flags, []);
});

test("line solver: Ahujas layout — amount half-read, CGST + line total agree", () => {
  // "1.36" is what was left of 22,881.36; CGST 9% = 2,059.32; total 27,000.00
  const s = solveLine({
    qty: 2,
    values: [
      { value: 1.36, alts: [], quality: 1, role: null, text: "1.36", order: 0, count: 3 },
      { value: 2059.32, alts: [], quality: 1, role: null, text: "2,059.32", order: 1, count: 3 },
      { value: 27000, alts: [], quality: 1, role: null, text: "27,000.00", order: 2, count: 3 },
    ],
    percents: [
      { value: 9, text: "9%" },
      { value: 9, text: "9%" },
    ],
  });
  assert.equal(s.gstRate, 18);
  assert.equal(s.taxableValue, 22881.36);
  assert.equal(s.amount, 22881.36, "Amount column is before tax on this layout");
  assert.equal(s.amountIncludesTax, false);
  assert.equal(s.rateExclTax, 11440.68);
  assert.equal(s.rateInclTax, 13500);
  assert.deepEqual(s.flags, []);
});

test("HSN: letter misreads fixed, damaged codes snapped, real codes kept", () => {
  assert.equal(cleanHsn("g4182100"), "84182100");
  assert.equal(cleanHsn("Ba182100"), "84182100");
  assert.equal(cleanHsn("84152100"), "84182100", "not a real code, one digit from a fridge code");
  assert.equal(cleanHsn("85044090"), "85044090", "a real code that is not in the list stays");
  assert.equal(cleanHsn("1,13,983.05"), null);
});

test("GSTIN: ambiguous misreads resolved by the check digit", () => {
  assert.equal(normalizeGstin("06AAQCAT37EN1ZU"), "06AAQCA7376N1ZU");
  assert.equal(gstinChecksumOk("06AAQCA7376N1ZU"), true);
});

test("straighten: a tilted page's rows come back together", () => {
  // Three item rows tilted by 3%: the amount at the right sits ~a row lower than the description.
  const words: OcrWord[] = [];
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 6; c++) {
      const x = 50 + c * 180;
      const y = 300 + r * 30 + x * 0.03;
      words.push({ text: c === 0 ? `ITEM${r}` : `${r}${c},000.00`, conf: 90, x0: x, y0: y, x1: x + 120, y1: y + 18 });
    }
  }
  const before = groupRows(words, 18);
  const after = groupRows(straighten(words, 18).words, 18);
  assert.ok(before.length > 12, "tilt splits rows");
  assert.equal(after.length, 12);
  assert.ok(after.every((row) => row.words.length === 6));
});

test("match: model number found inside the supplier's description", () => {
  const catalog: CatalogItem[] = [
    { id: "a", modelNumber: "GL-T2516WXDS", variantName: "Silver", brand: "LG", productName: "Double Door 251 L", categoryId: null, categoryName: "", currentStock: 2 },
    { id: "b", modelNumber: "WTT70DLIM/UHA", variantName: "Top Load", brand: "Voltas", productName: "WM 7 Kg", categoryId: null, categoryName: "", currentStock: 0 },
  ];
  assert.equal(matchByModel("REF -GLT2516WXDS D.DOOR LG 251 LITER", catalog)?.id, "a");
  assert.equal(matchByModel("WM-7 KG WTT70DLIM/UHA VOLTAS", catalog)?.id, "b");
  assert.equal(matchByModel("LG 1.5 Ton Split AC", catalog), null);
});
