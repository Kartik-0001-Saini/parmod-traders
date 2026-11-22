/**
 * Item-table rows → what is printed on them.
 *
 * Works from the left: serial no. → description → HSN → quantity, then every
 * number after that becomes an observation for the line solver. Column headings,
 * when readable, only label those numbers (a preference, not a rule), because on
 * phone photos headings are often garbled and columns drift.
 */
import { ColumnAnchor, ColumnRole, OcrWord } from "./types";
import { Row, centerX, columnOf } from "./layout";
import {
  COUNT_UNITS,
  isUnit,
  looksLikeMoney,
  normalizeUnit,
  parseLooseMoney,
  parsePercent,
  parseQuantityWithUnit,
} from "./numbers";
import { LineObs, PercentObs, ValueObs, ValueRole } from "./line-solver";

export type RowKind = "item" | "batch" | "text" | "money" | "qtyOnly" | "empty";

export interface ItemRow {
  kind: RowKind;
  sl: number | null;
  description: string;
  hsn: string | null;
  qty: number | null;
  unit: string | null;
  obs: LineObs;
  /** x where values start (text left of it is description). */
  firstValueX: number;
  y: number;
}

const HSN_FIXES: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0", I: "1", l: "1", i: "1", "|": "1", "!": "1", Z: "2", z: "2",
  S: "5", s: "5", G: "6", b: "6", B: "8", g: "9", a: "4", A: "4",
};

/**
 * HSN codes this showroom's goods use (fridges, ACs, washing machines, TVs, coolers,
 * small appliances). A read code that isn't one of these but is one digit away from
 * exactly one of them is snapped to it ("84152100" → "84182100").
 */
const KNOWN_HSN = [
  "84181010", "84181090", "84182100", "84182900", "84183010", "84183090", "84184010", "84184090", "84185000",
  "84151010", "84151090", "84158110", "84158210", "84158390", "84159000",
  "84501100", "84501200", "84501900", "84502000",
  "85287211", "85287212", "85287213", "85287214", "85287215", "85287216", "85287217", "85287218", "85287219", "85287390",
  "84796000", "84145110", "84145120", "84145130", "84145140", "84145190", "84146000",
  "85165000", "85161000", "85094010", "85164000", "85166000", "85044010", "85182100", "85182200", "85182900", "85183000",
  "84212110", "84212120", "85081100",
];

const KNOWN_HSN_PREFIX = new Set(KNOWN_HSN.map((k) => k.slice(0, 6)));

function snapHsn(code: string, hadLetters: boolean): string {
  if (KNOWN_HSN.includes(code)) return code;
  // A real code we just don't list (85044090) stays; only snap reads that are clearly damaged.
  if (!hadLetters && KNOWN_HSN_PREFIX.has(code.slice(0, 6))) return code;
  const near = KNOWN_HSN.filter((k) => [...k].filter((c, i) => c !== code[i]).length === 1);
  return near.length === 1 ? near[0] : code;
}

/**
 * An HSN code (8 digits; 4 or 6 only when under the HSN heading). Fixes the usual
 * letter-for-digit misreads; "g4182100" → "84182100" (HSNs for goods start 84/85…).
 */
export function cleanHsn(text: string, inHsnColumn = false): string | null {
  const t = text.trim().replace(/^[[(|{]+|[\])|}.,:]+$/g, "");
  if (/[.,]/.test(t)) return null; // amounts are never HSN codes
  let letters = 0;
  let digits = t.replace(/[^0-9]/g, (c) => {
    letters++;
    return HSN_FIXES[c] ?? "x";
  });
  if (digits.includes("x") || letters > 2) return null;
  if (/^9[45]/.test(digits) && /^g/.test(t)) digits = "8" + digits.slice(1);
  if (digits.length === 8) return snapHsn(digits, letters > 0);
  if (inHsnColumn && (digits.length === 4 || digits.length === 6) && letters === 0) return digits;
  return null;
}

const HEADING_TO_VALUE: Partial<Record<ColumnRole, ValueRole>> = {
  rate: "rate",
  rateIncl: "rateIncl",
  amount: "amount",
  taxable: "taxable",
  tax: "tax",
  total: "total",
};

/** "Batch : 601NRSP358974" lines under an item (Ahujas / LG bills). */
function isBatchWord(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  return /^(batch|balch|baich|batc|bach|btch|batoh|ba)$/.test(t) || /^b[a-z]?[at][a-z]?ch$/.test(t);
}

/** Margin marks before the serial number: ticks, "&", a stray letter, quotes. */
function isMarginJunk(text: string): boolean {
  return /^[^A-Za-z0-9]+$/.test(text) || /^[a-z]$/.test(text) || /^[A-Z]$/.test(text) || /^[“”"'‘’]\d$/.test(text);
}

/** Leading serial number: "1", "2|", "4/", "1]", or glued "1|1LG" / "4/WM-9KG". */
function splitSerial(input: OcrWord[]): { sl: number | null; words: OcrWord[] } {
  let words = input;
  // Skip pen ticks / stray marks in the left margin ("a 5/WM-7 KG", "A & WM 9KG").
  while (words.length > 1 && isMarginJunk(words[0].text) && /\d|[A-Z]{2}/.test(words.slice(1, 3).map((w) => w.text).join(""))) words = words.slice(1);
  if (words.length === 0) return { sl: null, words };
  const first = words[0];
  const alone = /^(\d{1,2})[.|\])/:]?$/.exec(first.text);
  if (alone) {
    const rest = words.slice(1);
    // Two serial-looking tokens ("5 11| REF …"): the one next to the description is the real one.
    const second = rest[0] && /^(\d{1,2})[.|\])/:]$/.exec(rest[0].text);
    if (second) return { sl: parseInt(second[1], 10), words: rest.slice(1) };
    return { sl: parseInt(alone[1], 10), words: rest };
  }
  const glued = /^(\d{1,2})[|\])/:](.+)$/.exec(first.text);
  if (glued) {
    // "1|1LG" → the second "1" is the table border; keep "LG".
    const rest = glued[2].replace(/^[1lI|](?=[A-Z])/, "");
    return { sl: parseInt(glued[1], 10), words: [{ ...first, text: rest }, ...words.slice(1)] };
  }
  return { sl: null, words };
}

interface Group {
  words: OcrWord[];
}

/** Text that is (part of) a number: digits with separators, maybe a stray letter. */
function numericish(text: string): boolean {
  const digits = (text.match(/\d/g) || []).length;
  return digits >= 1 && digits / text.replace(/[\s|)\]}(!]/g, "").length >= 0.5;
}

/** Already a whole amount ("18,200.00", "15.429.79|", "18.200.00,"): don't glue the next number onto it. */
function completeMoney(text: string): boolean {
  const t = text.trim().replace(/[|\])}!,.]+$/, "");
  return /\d[.,]\d{2}$/.test(t) && (looksLikeMoney(t) || /^\d{1,3}([.,]\d{2,3})*[.,]\d{2}$/.test(t));
}

export function readItemRow(row: Row, anchors: ColumnAnchor[] | null, h: number): ItemRow {
  const ambiguousRates = (anchors ?? []).filter((a) => a.role === "rate").length > 1;
  const hasAmountColumn = (anchors ?? []).some((a) => a.role === "amount");
  const roleOf = (w: OcrWord): ColumnRole | null => (anchors ? columnOf(w, anchors) : null);

  const { sl, words } = splitSerial(row.words);

  // HSN: 8 digits anywhere after the first word; 4/6 digits only under the HSN heading.
  let hsnIdx = -1;
  let hsn: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const c = cleanHsn(words[i].text, roleOf(words[i]) === "hsn");
    if (c && (i > 0 || words.length > 1)) {
      hsnIdx = i;
      hsn = c;
      break;
    }
  }

  // Quantities (shipped / billed): number + unit, after the HSN if there is one.
  const qtyIdx: number[] = [];
  let qty: number | null = null;
  let unit: string | null = null;
  let bareQty = false;
  for (let i = hsnIdx + 1; i < words.length; i++) {
    const t = words[i].text;
    const q = parseQuantityWithUnit(t);
    const role = roleOf(words[i]);
    const countUnit = q && COUNT_UNITS.has(q.unit);
    // A showroom bill line never has thousands of pieces: "16854 PCS" is a rate with the
    // "per" unit glued on. A second quantity is "Billed" next to "Shipped" — same number.
    const plausible =
      q && q.value > 0 && q.value <= 2000 && (qtyIdx.length === 0 || bareQty || (qtyIdx.length === 1 && q.value === qty));
    if (q && plausible && (hsnIdx >= 0 || countUnit || role === "qty")) {
      if (bareQty) qtyIdx.length = 0; // a number with a unit beats a bare number before it
      bareQty = false;
      qtyIdx.push(i);
      qty = q.value;
      unit = q.unit;
      continue;
    }
    if (role === "qty" && /^\d+(\.\d+)?$/.test(t) && Number(t) > 0 && Number(t) <= 2000 && qtyIdx.length === 0) {
      qtyIdx.push(i);
      qty = Number(t);
      bareQty = true;
      continue;
    }
    if (qtyIdx.length > 0 || looksLikeMoney(t)) break;
  }

  // Values start at the HSN / quantity / first money-looking token.
  let start = hsnIdx >= 0 ? hsnIdx : qtyIdx.length ? qtyIdx[0] : -1;
  if (start < 0) {
    start = words.findIndex((w) => looksLikeMoney(w.text) || (parseLooseMoney(w.text)?.quality ?? 0) >= 0.8);
    if (start < 0) start = words.length;
  }
  const descWords = words.slice(0, start).filter((w) => !(hsnIdx < 0 && qtyIdx.length === 0 && looksLikeMoney(w.text)));
  const description = descWords.map((w) => w.text).join(" ");

  // Everything right of the start: money groups, percents, units.
  const values: ValueObs[] = [];
  const percents: PercentObs[] = [];
  const skip = new Set<number>([hsnIdx, ...qtyIdx]);
  let group: Group | null = null;
  const flush = () => {
    if (!group) return;
    const text = group.words.map((w) => w.text).join(" ");
    const parsed = parseLooseMoney(text);
    if (parsed && parsed.value > 0) {
      const mid = { ...group.words[0], x0: group.words[0].x0, x1: group.words[group.words.length - 1].x1 };
      let heading = roleOf(mid);
      if (heading === null && looksLikeMoney(text) && !hasAmountColumn && anchors) heading = "amount";
      let role = heading ? HEADING_TO_VALUE[heading] ?? null : null;
      if (ambiguousRates && heading === "rate") role = null;
      values.push({ value: parsed.value, alts: parsed.alts, quality: parsed.quality, role, text });
    }
    group = null;
  };
  for (let i = start; i < words.length; i++) {
    if (skip.has(i)) {
      flush();
      continue;
    }
    let w = words[i];
    let t = w.text;
    // "8 PCS" in the value area: the 8 is the end of the rate before it ("8.728 8 PCS"), the PCS a unit.
    const glued = /^(\d[\d.,]*)\s*([A-Za-z]{2,5})[|\])}!.]*$/.exec(t);
    if (glued && normalizeUnit(glued[2])) {
      const numPart = glued[1];
      const ratio = numPart.length / t.length;
      w = { ...w, text: numPart, x1: w.x0 + (w.x1 - w.x0) * ratio };
      t = numPart;
      if (!unit) unit = normalizeUnit(glued[2]);
      const prev = group?.words[group.words.length - 1];
      if (group && prev && w.x0 - prev.x1 < h * 0.9 && !completeMoney(prev.text)) group.words.push(w);
      else {
        flush();
        group = { words: [w] };
      }
      flush();
      continue;
    }
    const pct = parsePercent(t.replace(/[|\])}]+$/, "")) ?? (/^\d{1,2}$/.test(t) && words[i + 1]?.text.startsWith("%") ? Number(t) : null);
    if (pct !== null) {
      flush();
      percents.push({ value: pct, text: t });
      continue;
    }
    if (isUnit(t) || normalizeUnit(t)) {
      if (!unit) unit = normalizeUnit(t);
      flush();
      continue;
    }
    if (!numericish(t)) {
      flush();
      continue;
    }
    const prev: OcrWord | undefined = group?.words[group.words.length - 1];
    const sameColumn = !anchors || !prev || roleOf(prev) === roleOf(w);
    if (group && prev && w.x0 - prev.x1 < h * 0.9 && !completeMoney(prev.text) && sameColumn) {
      group.words.push(w);
    } else {
      flush();
      group = { words: [w] };
    }
  }
  flush();
  values.forEach((v, i) => {
    v.order = i;
    v.count = values.length;
  });

  const firstValue = words[start];
  const descText = description.trim();
  let kind: RowKind;
  if (descWords.length > 0 && isBatchWord(descWords[0].text)) kind = "batch";
  else if (hsn !== null && (qty !== null || values.length > 0)) kind = "item";
  else if (qty !== null && values.length > 0) kind = "item";
  else if (qty !== null) kind = "qtyOnly";
  else if (values.length > 0 && !/[a-z]{3}/i.test(descText)) kind = "money";
  else if (descText) kind = "text";
  else kind = "empty";

  return {
    kind,
    sl,
    description: descText,
    hsn,
    qty,
    unit,
    obs: { qty, values, percents },
    firstValueX: firstValue ? firstValue.x0 : Infinity,
    y: row.y,
  };
}

/** Rows that look like an item (used to find the table when its heading is unreadable). */
export function looksLikeItemRow(row: Row): boolean {
  const hasHsn = row.words.some((w, i) => i > 0 && cleanHsn(w.text)?.length === 8);
  const hasQty = row.words.some((w) => {
    const q = parseQuantityWithUnit(w.text);
    return q !== null && COUNT_UNITS.has(q.unit);
  });
  const hasMoney = row.words.some((w) => looksLikeMoney(w.text));
  return hasHsn && (hasQty || hasMoney);
}

export { centerX };
