/**
 * Layout helpers: turn loose OCR words into rows, find the goods-table heading,
 * and work out where each column sits.
 *
 * Columns are found from the HEADING TEXT on each bill ("HSN", "Qty", "Rate",
 * "Amount" …), not from fixed pixel positions, so zoom/crop/phone differences
 * don't break it.
 */
import { ColumnAnchor, ColumnRole, OcrWord } from "./types";
import { isUnit } from "./numbers";

export interface Row {
  /** Vertical centre. */
  y: number;
  y0: number;
  y1: number;
  words: OcrWord[];
}

/** Tokens that are table borders or stray punctuation, not text. */
const NOISE = /^[|_\-—–=:;.,'"`~!\[\](){}<>«»\\/]+$/;

export function cleanWords(words: OcrWord[]): OcrWord[] {
  return words
    .map((w) => ({ ...w, text: w.text.replace(/\s+/g, " ").trim() }))
    .filter(
      (w) =>
        w.text.length > 0 &&
        !NOISE.test(w.text) &&
        // Tesseract sometimes scores a correctly read amount at 0 (e.g. next to a ₹ sign).
        // Keep numbers regardless: the arithmetic checks verify them.
        (w.conf >= 15 || /\d/.test(w.text)) &&
        w.x1 > w.x0 &&
        w.y1 > w.y0
    );
}

export function medianHeight(words: OcrWord[]): number {
  if (words.length === 0) return 10;
  const hs = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)] || 10;
}

export const centerX = (w: { x0: number; x1: number }) => (w.x0 + w.x1) / 2;
export const centerY = (w: { y0: number; y1: number }) => (w.y0 + w.y1) / 2;

/** Group words into visual rows (same line of the page), each sorted left → right. */
export function groupRows(words: OcrWord[], lineHeight: number): Row[] {
  const sorted = [...words].sort((a, b) => centerY(a) - centerY(b));
  const rows: Row[] = [];
  for (const w of sorted) {
    const cy = centerY(w);
    const row = rows.find((r) => Math.abs(r.y - cy) <= lineHeight * 0.55);
    if (row) {
      row.words.push(w);
      row.y0 = Math.min(row.y0, w.y0);
      row.y1 = Math.max(row.y1, w.y1);
      row.y = row.words.reduce((s, x) => s + centerY(x), 0) / row.words.length;
    } else {
      rows.push({ y: cy, y0: w.y0, y1: w.y1, words: [w] });
    }
  }
  rows.sort((a, b) => a.y - b.y);
  for (const r of rows) r.words.sort((a, b) => a.x0 - b.x0);
  return rows.map((r) => ({ ...r, words: mergeFragments(r.words, lineHeight) }));
}

function joinWords(a: OcrWord, b: OcrWord, sep: string): OcrWord {
  return {
    text: a.text + sep + b.text,
    conf: Math.min(a.conf, b.conf),
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Re-join pieces OCR split apart:
 *   "2," + "950.00" → "2,950.00"     "2" + "PCS" → "2 PCS"     "₹" + "1,200.00" → "₹1,200.00"
 */
export function mergeFragments(words: OcrWord[], lineHeight: number): OcrWord[] {
  const out: OcrWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = w.x0 - prev.x1;
      if (/\d,$/.test(prev.text) && /^\d/.test(w.text) && gap < lineHeight * 1.2) {
        out[out.length - 1] = joinWords(prev, w, "");
        continue;
      }
      if (/^\d+(\.\d+)?$/.test(prev.text) && isUnit(w.text) && gap < lineHeight * 1.5) {
        out[out.length - 1] = joinWords(prev, w, " ");
        continue;
      }
      if (/^(₹|rs\.?)$/i.test(prev.text) && /^\d/.test(w.text) && gap < lineHeight * 1.5) {
        out[out.length - 1] = joinWords(prev, w, "");
        continue;
      }
      // Thousands separator read as a space: "35" + "400.00" → "35,400.00".
      if (/^\d{1,3}$/.test(prev.text) && /^\d{3}\.\d{2}$/.test(w.text) && gap < lineHeight * 0.9) {
        out[out.length - 1] = joinWords(prev, w, ",");
        continue;
      }
      // An HSN code split in two: "84501" + "100" → "84501100".
      if (/^\d{4,6}$/.test(prev.text) && /^\d{2,4}$/.test(w.text) && (prev.text + w.text).length === 8 && gap < lineHeight * 0.8) {
        out[out.length - 1] = joinWords(prev, w, "");
        continue;
      }
    }
    out.push(w);
  }
  return out;
}

export function rowText(row: Row): string {
  return row.words.map((w) => w.text).join(" ");
}

/** Small edit distance, for OCR-damaged headings ("Anhount" ≈ "amount"). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function fuzzyIs(word: string, target: string): boolean {
  if (word === target) return true;
  if (word.length < 4) return false;
  return editDistance(word, target) <= (target.length >= 6 ? 2 : 1);
}

type HeadingKind = ColumnRole | "incl";

/** What a single heading word means, if anything. */
export function headingKind(rawText: string): HeadingKind | null {
  // "(₹)", "(%)", "(3)" are currency notes after a heading (often a misread ₹), not columns.
  if (/^\([^a-z]*\)?$/i.test(rawText.trim())) return null;
  const t = rawText.toLowerCase().replace(/[^a-z%/.]/g, "");
  const bare = t.replace(/[./]/g, "");
  if (!bare) return null;
  if (/hsn|sac/.test(bare)) return "hsn";
  if (/^(qty|qnty|quantity)$/.test(bare) || fuzzyIs(bare, "quantity")) return "qty";
  if (/incl|inclusive/.test(bare)) return "incl";
  if (/^rate/.test(bare)) return "rate";
  if (/^taxable/.test(bare) || fuzzyIs(bare, "taxable")) return "taxable";
  if (/^(amount|amt)/.test(bare) || fuzzyIs(bare, "amount")) return "amount";
  if (/^(description|particulars|goods|items?|products?)$/.test(bare) || fuzzyIs(bare, "description")) return "description";
  if (/^(cgst|sgst|utgst|sgstutgst|igst)$/.test(bare)) return "tax";
  if (/^(gst|gst%)$/.test(bare) || t === "%") return "gstPct";
  if (/^total$/.test(bare)) return "total";
  if (/^(disc|discount|disc%)$/.test(bare)) return "disc";
  if (bare === "per") return "per";
  if (/^(sl|si|sr|sno|slno|srno|no)$/.test(bare)) return "sl";
  return null;
}

export interface HeaderMatch {
  /** Index of the first heading row. */
  index: number;
  /** How many rows the heading uses (2 when "Rate" / "(incl. of Tax)" wrap). */
  rowCount: number;
  anchors: ColumnAnchor[];
}

/**
 * Find the goods-table heading: the first row (plus the row under it, for
 * two-line headings) that names at least 3 of description / HSN / qty / rate / amount.
 */
export function findHeader(rows: Row[], lineHeight: number): HeaderMatch | null {
  for (let i = 0; i < rows.length; i++) {
    const allKinds = rows[i].words.map((w) => headingKind(w.text)).filter(Boolean);
    const kinds = new Set(allKinds);
    const core = ["description", "hsn", "qty", "rate", "amount"].filter((k) => kinds.has(k as HeadingKind));
    // "Quantity Rate Rate per" (Description / HSN unreadable) still marks the heading.
    if (core.length < 3 && !(core.length === 2 && allKinds.length >= 4)) continue;

    let rowCount = 1;
    const next = rows[i + 1];
    if (next && next.y - rows[i].y < lineHeight * 1.9) {
      const nextKinds = next.words.map((w) => headingKind(w.text));
      const nextIsHeading =
        next.words.some((w, k) => nextKinds[k] !== null || /^(shipped|billed|value)$/i.test(w.text)) &&
        next.words.every(
          (w, k) => nextKinds[k] !== null || /^(of|tax\)?|\(.*|.*\)|no\.?|\(?₹\)?|%|shipped|billed|value|[|_\-]+)$/i.test(w.text)
        );
      if (nextIsHeading) rowCount = 2;
    }
    if (rowCount === 1) return { index: i, rowCount, anchors: buildAnchors(rows[i].words) };

    // Two-line heading. The second line holds "(incl. of Tax)" and sub-headings such as
    // "Shipped Billed" under Quantity or "Rate Amount" under CGST / SGST / Total.
    const top = rows[i].words;
    const sub = rows[i + 1].words;
    const anchors = buildAnchors([...top, ...sub.filter((w) => headingKind(w.text) === "incl" || !isSubHeading(w, top))]);
    for (const w of sub) {
      const kind = headingKind(w.text);
      if (kind !== "rate" && kind !== "amount") continue;
      const parent = nearestAnchor(anchors, centerX(w));
      if (!parent || (parent.role !== "tax" && parent.role !== "total")) continue;
      // "Amount" under CGST / SGST / Total marks where that column's numbers are;
      // "Rate" under CGST / SGST is the tax % column.
      if (kind === "amount") Object.assign(parent, { x: centerX(w), x0: w.x0, x1: w.x1 });
      else anchors.push({ role: "gstPct", x: centerX(w), x0: w.x0, x1: w.x1 });
    }
    anchors.sort((a, b) => a.x - b.x);
    return { index: i, rowCount, anchors };
  }
  return null;
}

function nearestAnchor(anchors: ColumnAnchor[], x: number): ColumnAnchor | undefined {
  return [...anchors].sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
}

/** A second-line heading word sitting under a group heading (CGST, SGST, Total, Quantity). */
function isSubHeading(w: OcrWord, top: OcrWord[]): boolean {
  const kind = headingKind(w.text);
  if (kind !== "rate" && kind !== "amount") return false;
  const cx = centerX(w);
  const nearest = [...top].filter((t) => headingKind(t.text)).sort((a, b) => Math.abs(centerX(a) - cx) - Math.abs(centerX(b) - cx))[0];
  const k = nearest ? headingKind(nearest.text) : null;
  return k === "tax" || k === "total" || k === "qty" || k === "taxable";
}

/** Turn heading words into column anchors (one per column, sorted left → right). */
export function buildAnchors(words: OcrWord[]): ColumnAnchor[] {
  const anchors: ColumnAnchor[] = [];
  const inclWords: OcrWord[] = [];

  for (const w of words) {
    const kind = headingKind(w.text);
    if (!kind) continue;
    if (kind === "incl") {
      inclWords.push(w);
      continue;
    }
    // Merge with an existing anchor of the same role that overlaps horizontally
    // ("Description" "of" "Goods" → one description column).
    const same = anchors.find(
      (a) => a.role === kind && kind !== "rate" && w.x0 <= a.x1 + (w.y1 - w.y0) * 4 && w.x1 >= a.x0 - (w.y1 - w.y0) * 4
    );
    if (same) {
      same.x0 = Math.min(same.x0, w.x0);
      same.x1 = Math.max(same.x1, w.x1);
      same.x = (same.x0 + same.x1) / 2;
    } else {
      anchors.push({ role: kind, x: centerX(w), x0: w.x0, x1: w.x1 });
    }
  }

  // "(incl. of Tax)" sits under one of the "Rate" headings → that column is rate incl. tax.
  const rates = anchors.filter((a) => a.role === "rate");
  for (const iw of inclWords) {
    const cx = centerX(iw);
    const nearest = rates.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx))[0];
    if (nearest) {
      nearest.role = "rateIncl";
      nearest.x0 = Math.min(nearest.x0, iw.x0);
      nearest.x1 = Math.max(nearest.x1, iw.x1);
      nearest.x = (nearest.x0 + nearest.x1) / 2;
    } else {
      anchors.push({ role: "rateIncl", x: cx, x0: iw.x0, x1: iw.x1 });
    }
  }

  // A stray "No." under "Sl." also maps to "sl" — keep only one sl anchor (the leftmost).
  const result = anchors.sort((a, b) => a.x - b.x);
  return result.filter((a, i) => !(a.role === "sl" && result.findIndex((b) => b.role === "sl") !== i));
}

/**
 * Which column a word belongs to: boundaries sit halfway between neighbouring headings.
 * The last column ends a little after its heading (not at the page edge), so values under
 * a heading OCR missed (e.g. a cut-off "Amount") come back as null instead of being
 * swallowed by the previous column.
 */
export function columnOf(word: OcrWord, anchors: ColumnAnchor[]): ColumnRole | null {
  if (anchors.length === 0) return null;
  const cx = centerX(word);
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const left = i === 0 ? -Infinity : (anchors[i - 1].x1 + a.x0) / 2;
    const right = i === anchors.length - 1 ? a.x1 + Math.max(3 * (a.x1 - a.x0), 60) : (a.x1 + anchors[i + 1].x0) / 2;
    if (cx >= left && cx < right) return anchors[i].role;
  }
  return null;
}
