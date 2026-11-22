/**
 * Reads the bill's header: supplier & buyer names, GSTINs, invoice number,
 * invoice date, and e-invoice IRN.
 *
 * Works for labels on the same line ("Invoice No.: TEST/26-27/0001") and for
 * Tally-style boxes where the value sits under the label ("Invoice No." / "26-27/6821").
 */
import { BillHeader, OcrWord } from "./types";
import { Row, centerX } from "./layout";

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GSTIN check digit (15th character), mod-36 scheme used by the GST portal. */
export function gstinChecksumOk(gstin: string): boolean {
  if (!GSTIN_PATTERN.test(gstin)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === gstin[14];
}

/** Fix common OCR swaps by position (digits vs letters), then validate the shape. */
export function normalizeGstin(candidate: string): string | null {
  const c = candidate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 15) return null;
  const toDigit: Record<string, string> = { O: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };
  const toLetter: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G" };
  const digitPos = [0, 1, 7, 8, 9, 10];
  const letterPos = [2, 3, 4, 5, 6, 11];
  const chars = c.split("");
  for (const i of digitPos) chars[i] = toDigit[chars[i]] ?? chars[i];
  for (const i of letterPos) chars[i] = toLetter[chars[i]] ?? chars[i];
  if (chars[13] === "2") chars[13] = "Z";
  const fixed = chars.join("");
  return GSTIN_PATTERN.test(fixed) ? fixed : null;
}

interface FoundGstin {
  gstin: string;
  rowIndex: number;
  word: OcrWord;
}

function findGstins(rows: Row[]): FoundGstin[] {
  const found: FoundGstin[] = [];
  rows.forEach((row, rowIndex) => {
    for (const w of row.words) {
      const compact = w.text.toUpperCase().replace(/[^A-Z0-9]/g, "");
      // Skip long tokens (the 64-char IRN) so a random slice can't pass as a GSTIN.
      if (compact.length > 26) continue;
      // The GSTIN may be glued to its label: "GSTIN/UIN:06AAAFJ7674N1ZF".
      for (let start = 0; start + 15 <= compact.length; start++) {
        const g = normalizeGstin(compact.slice(start, start + 15));
        if (g && !found.some((f) => f.gstin === g)) {
          found.push({ gstin: g, rowIndex, word: w });
          break;
        }
      }
    }
  });
  return found;
}

/** Split a row into horizontal segments (runs of words without a wide gap). */
function segments(row: Row, lineHeight: number): OcrWord[][] {
  const segs: OcrWord[][] = [];
  for (const w of row.words) {
    const last = segs[segs.length - 1];
    if (last && w.x0 - last[last.length - 1].x1 < lineHeight * 3) last.push(w);
    else segs.push([w]);
  }
  return segs;
}

const PARTY_LABEL = /^(supplier|seller|sold\s*by|bill(ed)?\s*(from|to)|buyer|consignee|ship(ped)?\s*to|consignor|details\s*of|tax\s*invoice|irn|ack)/i;
const PARTY_DETAIL = /e-?mail|@|state\s*name|state\s*\/|gstin|contact|phone|mob(ile)?|pan\b|irn|ack\s*(no|date)/i;

/**
 * Left edge of the address block a GSTIN belongs to. If the row has a "GSTIN/UIN" label
 * left of the number ("GSTIN/UIN      : 06BTGPM…"), the block starts at the label.
 */
function gstinBlockX0(rows: Row[], found: FoundGstin, lineHeight: number): number {
  const row = rows[found.rowIndex];
  const label = row.words.find(
    (w) => /gstin|uin/i.test(w.text) && w.x0 <= found.word.x0 && found.word.x0 - w.x1 < lineHeight * 14
  );
  if (label) return label.x0;
  return segments(row, lineHeight).find((s) => s.includes(found.word))?.[0].x0 ?? found.word.x0;
}

/**
 * Party name = top line of the address block that ends with the GSTIN line.
 * Walks upward from the GSTIN row while lines stay left-aligned and close together.
 */
function partyNameAbove(rows: Row[], found: FoundGstin, lineHeight: number): string | null {
  const gRow = rows[found.rowIndex];
  const blockX0 = gstinBlockX0(rows, found, lineHeight);

  const lines: string[] = [];
  let prevY = gRow.y;
  for (let i = found.rowIndex - 1; i >= 0; i--) {
    const row = rows[i];
    if (prevY - row.y > lineHeight * 2.4) break;
    const seg = segments(row, lineHeight).find((s) => Math.abs(s[0].x0 - blockX0) < lineHeight * 3);
    if (!seg) break;
    const text = seg.map((w) => w.text).join(" ").trim();
    if (PARTY_DETAIL.test(text)) break; // reached the previous party's block
    lines.unshift(text);
    prevY = row.y;
  }
  const name = lines.find((l) => !PARTY_LABEL.test(l) && /[A-Za-z]{2}/.test(l));
  return name ? name.replace(/[:\s]+$/, "").replace(/\s+/g, " ") : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** "12-Nov-26", "21-Nov-2026", "21/11/2026", "21.11.26", "21 Nov 2026" → "2026-11-21". */
export function parseDate(text: string): string | null {
  const t = text.trim().replace(/[,]/g, " ");
  let d: number, m: number, y: number;
  let match = /(\d{1,2})[-\s./]([A-Za-z]{3,4})[A-Za-z]*[-\s./,]*(\d{2,4})/.exec(t);
  if (match) {
    d = Number(match[1]);
    m = MONTHS[match[2].toLowerCase()];
    y = Number(match[3]);
  } else {
    match = /(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/.exec(t);
    if (!match) return null;
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  }
  if (!m || m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Value for a label: either on the same line after the label, or in the line
 * just below, under the label (Tally boxes).
 */
function valueForLabel(
  rows: Row[],
  lineHeight: number,
  labelTest: (rowWords: OcrWord[], i: number) => number, // returns index of last label word in row, or -1
  valueTest: (text: string) => boolean
): string | null {
  for (let r = 0; r < rows.length; r++) {
    const words = rows[r].words;
    for (let i = 0; i < words.length; i++) {
      const end = labelTest(words, i);
      if (end < 0) continue;
      const labelX0 = words[i].x0;
      const labelX1 = words[end].x1;

      // Same line: text glued after ":" in the label word, or the next words.
      const glued = words[end].text.split(":").slice(1).join(":").trim();
      if (glued && valueTest(glued)) return glued;
      const sameLine = words.slice(end + 1, end + 4).filter((w) => w.x0 - labelX1 < lineHeight * 6);
      for (const w of sameLine) {
        const t = w.text.replace(/^:/, "").trim();
        if (t && valueTest(t)) return t;
        if (t && !/^[:\-]$/.test(t)) break;
      }

      // Line below, under the label.
      for (let k = r + 1; k < rows.length && rows[k].y - rows[r].y < lineHeight * 2.6; k++) {
        const below = rows[k].words
          .filter((w) => centerX(w) > labelX0 - lineHeight && w.x0 < labelX1 + lineHeight * 2)
          .sort((a, b) => Math.abs(a.x0 - labelX0) - Math.abs(b.x0 - labelX0));
        for (const w of below) if (valueTest(w.text)) return w.text;
      }
    }
  }
  return null;
}

const looksLikeInvoiceNo = (t: string) => /\d/.test(t) && t.length >= 2 && t.length <= 30 && !/^\d{1,2}[-/][A-Za-z]{3}/.test(t);

function findInvoiceNumber(rows: Row[], h: number): string | null {
  return valueForLabel(
    rows,
    h,
    (ws, i) => {
      if (!/^invoice$/i.test(ws[i].text.replace(/[^A-Za-z]/g, ""))) return -1;
      const next = ws[i + 1];
      return next && /^(no|number|#)/i.test(next.text.replace(/[^A-Za-z#]/g, "")) ? i + 1 : -1;
    },
    looksLikeInvoiceNo
  );
}

function findInvoiceDate(rows: Row[], h: number): string | null {
  const isDate = (t: string) => parseDate(t) !== null;
  // 1. "Invoice Date"  2. "Dated" (Tally)  3. "Date" on its own  4. "Ack Date"
  const labels: ((ws: OcrWord[], i: number) => number)[] = [
    (ws, i) => (/^invoice$/i.test(ws[i].text) && ws[i + 1] && /^date/i.test(ws[i + 1].text) ? i + 1 : -1),
    (ws, i) => (/^dated:?$/i.test(ws[i].text) ? i : -1),
    (ws, i) => (/^date:?$/i.test(ws[i].text) && !/(ack|note|order|delivery)/i.test(ws[i - 1]?.text ?? "") ? i : -1),
    (ws, i) => (/^ack$/i.test(ws[i].text) && ws[i + 1] && /^date/i.test(ws[i + 1].text) ? i + 1 : -1),
  ];
  for (const label of labels) {
    const v = valueForLabel(rows, h, label, isDate);
    if (v) return parseDate(v);
  }
  // Dates split into words: "21 Nov 2026"
  for (const row of rows.slice(0, Math.ceil(rows.length * 0.5))) {
    const d = parseDate(row.words.map((w) => w.text).join(" "));
    if (d) return d;
  }
  return null;
}

function findIrn(rows: Row[], h: number): string | null {
  for (let r = 0; r < rows.length; r++) {
    const idx = rows[r].words.findIndex((w) => /^irn/i.test(w.text));
    if (idx < 0) continue;
    const label = rows[r].words[idx];
    let hex = rows[r].words
      .slice(idx)
      .map((w) => w.text.replace(/^irn:?/i, ""))
      .join("")
      .toLowerCase()
      .replace(/[^0-9a-f]/g, "");
    // Long IRNs wrap onto the next line.
    const next = rows[r + 1];
    if (hex.length < 64 && next && next.y - rows[r].y < h * 2) {
      const cont = next.words.filter((w) => w.x0 > label.x1);
      hex += cont.map((w) => w.text).join("").toLowerCase().replace(/[^0-9a-f]/g, "");
    }
    return hex.length >= 64 ? hex.slice(0, 64) : null;
  }
  return null;
}

export interface HeaderResult {
  header: BillHeader;
  warnings: string[];
}

interface PartyLabel {
  rowIndex: number;
  x0: number;
}

// Not "Buyer's Order No." / "Supplier's Ref." — those are Tally reference fields, not party blocks.
const SUPPLIER_LABEL = /^(supplier(?!['’]s)|seller|sold\s*by|bill(ed)?\s*from|consignor)\b/i;
const BUYER_LABEL = /^(buyer(?!['’]s)|bill(ed)?\s*to|consignee|ship(ped)?\s*to|details\s*of\s*receiver)\b/i;

/** "SUPPLIER / SELLER", "BUYER / BILL TO", "Consignee (Ship to)" … */
function findPartyLabel(rows: Row[], pattern: RegExp, lineHeight: number): PartyLabel | null {
  for (let i = 0; i < rows.length; i++) {
    for (const seg of segments(rows[i], lineHeight)) {
      const text = seg.map((w) => w.text).join(" ");
      if (pattern.test(text) && text.length < 40) return { rowIndex: i, x0: seg[0].x0 };
    }
  }
  return null;
}

/** First real line under a party label, in the same column. */
function nameBelowLabel(rows: Row[], label: PartyLabel, lineHeight: number): string | null {
  for (let i = label.rowIndex + 1; i < rows.length && rows[i].y - rows[label.rowIndex].y < lineHeight * 4; i++) {
    const seg = segments(rows[i], lineHeight).find((s) => Math.abs(s[0].x0 - label.x0) < lineHeight * 3);
    if (!seg) continue;
    const text = seg.map((w) => w.text).join(" ").trim();
    if (!PARTY_LABEL.test(text) && /[A-Za-z]{2}/.test(text)) return text.replace(/[:\s]+$/, "");
  }
  return null;
}

export function readHeader(rows: Row[], lineHeight: number): HeaderResult {
  const warnings: string[] = [];
  const gstins = findGstins(rows);
  const supplierLabel = findPartyLabel(rows, SUPPLIER_LABEL, lineHeight);
  const buyerLabel = findPartyLabel(rows, BUYER_LABEL, lineHeight);

  // Assign GSTINs to parties: by the label above them (if the bill has labels), else in
  // reading order — the supplier's block comes first on Indian tax invoices.
  let supplier: FoundGstin | null = null;
  let buyer: FoundGstin | null = null;
  const unassigned: FoundGstin[] = [];
  for (const g of gstins) {
    const x0 = gstinBlockX0(rows, g, lineHeight);
    const under = (l: PartyLabel | null) => l !== null && l.rowIndex < g.rowIndex && Math.abs(l.x0 - x0) < lineHeight * 4;
    if (!supplier && under(supplierLabel)) supplier = g;
    else if (!buyer && under(buyerLabel)) buyer = g;
    else unassigned.push(g);
  }
  if (!supplier && !supplierLabel) supplier = unassigned.shift() ?? null;
  if (!buyer && !buyerLabel) buyer = unassigned.shift() ?? null;

  for (const g of [supplier, buyer]) {
    if (g && !gstinChecksumOk(g.gstin)) warnings.push(`GSTIN ${g.gstin} fails its check digit — check for a misread character.`);
  }
  if (!supplier) warnings.push("Supplier GSTIN not found.");

  const header: BillHeader = {
    supplierName:
      (supplierLabel ? nameBelowLabel(rows, supplierLabel, lineHeight) : null) ??
      (supplier ? partyNameAbove(rows, supplier, lineHeight) : null),
    supplierGstin: supplier?.gstin ?? null,
    buyerName:
      (buyerLabel ? nameBelowLabel(rows, buyerLabel, lineHeight) : null) ??
      (buyer ? partyNameAbove(rows, buyer, lineHeight) : null),
    buyerGstin: buyer?.gstin ?? null,
    invoiceNumber: findInvoiceNumber(rows, lineHeight),
    invoiceDate: findInvoiceDate(rows, lineHeight),
    irn: findIrn(rows, lineHeight),
  };
  if (!header.invoiceNumber) warnings.push("Invoice number not found.");
  if (!header.invoiceDate) warnings.push("Invoice date not found.");
  return { header, warnings };
}
