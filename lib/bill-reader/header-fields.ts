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

/** Letters OCR reads in place of a digit, and the digits they could be. */
const AS_DIGIT: Record<string, string[]> = {
  O: ["0"], D: ["0"], Q: ["0"], U: ["0"], I: ["1"], L: ["1"], T: ["7", "1"], Z: ["2"], S: ["5"], B: ["8"], G: ["6"], E: ["6", "8"], A: ["4"],
};
/** Digits OCR reads in place of a letter, and the letters they could be. */
const AS_LETTER: Record<string, string[]> = {
  "0": ["O", "D", "Q"], "1": ["I", "L"], "2": ["Z"], "4": ["A"], "5": ["S"], "6": ["G"], "7": ["T"], "8": ["B"],
};

/**
 * Fix OCR swaps by position (digits vs letters). Where a character could be more than
 * one thing ("T" = 7 or 1), the variant whose check digit is right wins; otherwise the
 * first variant with the right shape is returned (and fails the checksum warning later).
 */
export function normalizeGstin(candidate: string): string | null {
  const c = candidate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 15) return null;
  const digitPos = new Set([0, 1, 7, 8, 9, 10]);
  const letterPos = new Set([2, 3, 4, 5, 6, 11]);
  const options: string[][] = c.split("").map((ch, i) => {
    if (digitPos.has(i) && /[A-Z]/.test(ch)) return AS_DIGIT[ch] ?? [ch];
    if (letterPos.has(i) && /\d/.test(ch)) return AS_LETTER[ch] ?? [ch];
    if (i === 13 && ch === "2") return ["Z"];
    return [ch];
  });
  const combos = options.reduce((n, o) => n * o.length, 1);
  if (combos > 512) return null;
  let firstShape: string | null = null;
  const walk = (i: number, acc: string): string | null => {
    if (i === 15) {
      if (!GSTIN_PATTERN.test(acc)) return null;
      firstShape ??= acc;
      return gstinChecksumOk(acc) ? acc : null;
    }
    for (const ch of options[i]) {
      const r = walk(i + 1, acc + ch);
      if (r) return r;
    }
    return null;
  };
  return walk(0, "") ?? firstShape;
}

/** Number of positions where two GSTIN-length strings differ. */
function gstinDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < 15; i++) if (a[i] !== b[i]) d++;
  return d;
}

export interface KnownSupplier {
  name: string;
  gstin: string | null;
}

export interface HeaderOptions {
  /** The shop's own GSTIN: always the buyer, never the supplier. */
  ownGstin?: string | null;
  /** Suppliers already in the app: recognised from a partly read GSTIN or their name. */
  knownSuppliers?: KnownSupplier[];
}

interface FoundGstin {
  gstin: string;
  rowIndex: number;
  word: OcrWord;
}

function findGstins(rows: Row[]): FoundGstin[] {
  const found: FoundGstin[] = [];
  const tryText = (text: string, rowIndex: number, w: OcrWord) => {
    const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Skip long tokens (the 64-char IRN) so a random slice can't pass as a GSTIN.
    if (compact.length > 26 || compact.length < 15) return false;
    // The GSTIN may be glued to its label: "GSTIN/UIN:06AAAFJ7674N1ZF".
    for (let start = 0; start + 15 <= compact.length; start++) {
      const slice = compact.slice(start, start + 15);
      if (!/^[0O]?\d/.test(slice) && !/^\d/.test(slice)) continue;
      const g = normalizeGstin(slice);
      if (g && !found.some((f) => f.gstin === g)) {
        found.push({ gstin: g, rowIndex, word: w });
        return true;
      }
    }
    return false;
  };
  rows.forEach((row, rowIndex) => {
    row.words.forEach((w, i) => {
      if (tryText(w.text, rowIndex, w)) return;
      // OCR sometimes splits it: "06AAQCAT37EN1" + "ZU".
      const next = row.words[i + 1];
      if (next && next.x0 - w.x1 < (w.y1 - w.y0) * 1.5) tryText(w.text + next.text, rowIndex, w);
    });
  });
  // Prefer GSTINs that pass the check digit; drop near-duplicates of them (misreads of the same one).
  const good = found.filter((f) => gstinChecksumOk(f.gstin));
  return found.filter((f) => gstinChecksumOk(f.gstin) || !good.some((g) => gstinDistance(g.gstin, f.gstin) <= 3));
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

/** Street-address words: the line above the first address line is the party's name. */
const ADDRESS_WORD = /\b(mill|marg|road|rd|nagar|gate|floor|colony|mandi|bazar|bazaar|market|street|sector|plot|shop|complex|chowk|near|opp|#\d+)\b/i;

/** Supplier name when its GSTIN wasn't readable: the line above the first address line. */
function nameAboveAddress(rows: Row[], lineHeight: number): string | null {
  const limit = Math.ceil(rows.length * 0.45);
  for (let i = 1; i < limit; i++) {
    const seg = segments(rows[i], lineHeight).find((s) => ADDRESS_WORD.test(s.map((w) => w.text).join(" ")));
    if (!seg) continue;
    const x0 = seg[0].x0;
    for (let k = i - 1; k >= 0 && rows[i].y - rows[k].y < lineHeight * 3; k--) {
      const above = segments(rows[k], lineHeight).find((s) => Math.abs(s[0].x0 - x0) < lineHeight * 3);
      if (!above) continue;
      const text = above.map((w) => w.text).join(" ").trim();
      if (PARTY_LABEL.test(text) || PARTY_DETAIL.test(text) || !/[A-Za-z]{3}/.test(text)) break;
      return text.replace(/[:\s]+$/, "").replace(/\s+/g, " ");
    }
    return null;
  }
  return null;
}

/** "JINDAL ELECTRONIC s" ≈ "JINDAL ELECTRONICS"; first distinctive word must match. */
function textHasName(text: string, name: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/['’]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  const words = norm(text).split(" ");
  const key = norm(name).split(" ").find((w) => w.length >= 4);
  if (!key) return false;
  return words.some((w) => w === key || (w.length >= 4 && Math.abs(w.length - key.length) <= 1 && editDistance(w, key) <= 1));
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** A known supplier whose GSTIN appears (even partly: 8+ characters in a row) or whose name appears. */
function findKnownSupplier(rows: Row[], known: KnownSupplier[], ownGstin: string | null): KnownSupplier | null {
  const top = rows.slice(0, Math.ceil(rows.length * 0.5));
  const compact = top.map((r) => r.words.map((w) => w.text).join("").toUpperCase().replace(/[^A-Z0-9]/g, "")).join("|");
  for (const s of known) {
    if (!s.gstin || s.gstin === ownGstin) continue;
    for (let start = 0; start + 8 <= 15; start++) {
      if (compact.includes(s.gstin.slice(start, start + 8))) return s;
    }
  }
  const text = top.map((r) => r.words.map((w) => w.text).join(" ")).join("\n");
  return known.find((s) => s.gstin !== ownGstin && textHasName(text, s.name)) ?? null;
}

/** Tally invoice numbers carry the financial year: "2627/6669" → "26-27/6669". */
function fixInvoiceNumber(raw: string | null): string | null {
  if (!raw) return raw;
  const m = /^(\d{2})[.\s]?(\d{2})\/(\d+)$/.exec(raw);
  if (m && Number(m[2]) === Number(m[1]) + 1) return `${m[1]}-${m[2]}/${m[3]}`;
  return raw;
}

export function readHeader(rows: Row[], lineHeight: number, options: HeaderOptions = {}): HeaderResult {
  const warnings: string[] = [];
  const ownGstin = options.ownGstin ? options.ownGstin.toUpperCase() : null;
  const isOwn = (g: string) => ownGstin !== null && gstinDistance(g, ownGstin) <= 3;
  const gstins = findGstins(rows);
  const supplierLabel = findPartyLabel(rows, SUPPLIER_LABEL, lineHeight);
  const buyerLabel = findPartyLabel(rows, BUYER_LABEL, lineHeight);

  // Assign GSTINs to parties: the shop's own GSTIN is the buyer; then by the label above
  // them (if the bill has labels), else in reading order — the supplier's block comes first.
  let supplier: FoundGstin | null = null;
  let buyer: FoundGstin | null = null;
  const unassigned: FoundGstin[] = [];
  for (const g of gstins) {
    if (isOwn(g.gstin)) {
      buyer ??= g;
      continue;
    }
    const x0 = gstinBlockX0(rows, g, lineHeight);
    const under = (l: PartyLabel | null) => l !== null && l.rowIndex < g.rowIndex && Math.abs(l.x0 - x0) < lineHeight * 4;
    if (!supplier && under(supplierLabel)) supplier = g;
    else if (!buyer && under(buyerLabel)) buyer = g;
    else unassigned.push(g);
  }
  if (!supplier && !supplierLabel) supplier = unassigned.shift() ?? null;
  if (!buyer && !buyerLabel && !ownGstin) buyer = unassigned.shift() ?? null;

  let supplierName =
    (supplierLabel ? nameBelowLabel(rows, supplierLabel, lineHeight) : null) ??
    (supplier ? partyNameAbove(rows, supplier, lineHeight) : null);
  let supplierGstin = supplier?.gstin ?? null;

  // Suppliers the shop already buys from: recognise them from fragments.
  const known = options.knownSuppliers ?? [];
  if (known.length) {
    const byGstin = supplierGstin ? known.find((s) => s.gstin && gstinDistance(s.gstin, supplierGstin as string) <= 2) : undefined;
    const match = byGstin ?? (!supplierGstin || !gstinChecksumOk(supplierGstin) ? findKnownSupplier(rows, known, ownGstin) : null);
    if (match) {
      supplierName = match.name;
      supplierGstin = match.gstin ?? supplierGstin;
    }
  }
  supplierName ??= nameAboveAddress(rows, lineHeight);

  if (supplierGstin && !gstinChecksumOk(supplierGstin)) warnings.push(`GSTIN ${supplierGstin} fails its check digit — check for a misread character.`);
  if (buyer && !isOwn(buyer.gstin) && !gstinChecksumOk(buyer.gstin)) warnings.push(`GSTIN ${buyer.gstin} fails its check digit — check for a misread character.`);
  if (!supplierGstin) warnings.push("Supplier GSTIN not found.");

  const header: BillHeader = {
    supplierName,
    supplierGstin,
    buyerName:
      (buyerLabel ? nameBelowLabel(rows, buyerLabel, lineHeight) : null) ??
      (buyer ? partyNameAbove(rows, buyer, lineHeight) : null),
    buyerGstin: buyer ? (isOwn(buyer.gstin) && ownGstin ? ownGstin : buyer.gstin) : null,
    invoiceNumber: fixInvoiceNumber(findInvoiceNumber(rows, lineHeight)),
    invoiceDate: findInvoiceDate(rows, lineHeight),
    irn: findIrn(rows, lineHeight),
  };
  if (!header.invoiceNumber) warnings.push("Invoice number not found.");
  if (!header.invoiceDate) warnings.push("Invoice date not found.");
  return { header, warnings };
}
