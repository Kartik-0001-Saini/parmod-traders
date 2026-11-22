/**
 * Number helpers for Indian GST bills: amounts (2,59,110.00), quantities
 * ("2 PCS", "100MTR"), GST rates, and tolerant comparisons.
 */

export interface ParsedAmount {
  value: number;
  /** true if the text looked damaged (bad comma grouping, letters fixed to digits). */
  suspicious: boolean;
}

/** GST rates that exist in India (percent). Used to recognise incl ÷ excl ratios. */
export const GST_SLABS = [0, 0.25, 3, 5, 12, 18, 28, 40];

const UNITS = [
  "PCS", "PC", "NOS", "NO", "MTR", "MTRS", "M", "KG", "KGS", "SET", "SETS",
  "BOX", "UNIT", "UNITS", "PAIR", "PRS", "ROLL", "LTR", "BAG", "PKT",
];

/** Common OCR letter-for-digit confusions inside numbers. */
const DIGIT_FIXES: Record<string, string> = { O: "0", o: "0", D: "0", l: "1", I: "1", "|": "1", S: "5", B: "8" };

/**
 * Valid comma grouping: Western (1,234,567) or Indian (12,34,567).
 * "2,32.00" is neither, a sign that OCR dropped a digit.
 */
function hasValidGrouping(intPart: string): boolean {
  if (!intPart.includes(",")) return true;
  const groups = intPart.split(",");
  const first = groups[0];
  const rest = groups.slice(1);
  if (first.length < 1 || first.length > 3) return false;
  const western = rest.every((g) => g.length === 3);
  const last = rest[rest.length - 1];
  const middle = rest.slice(0, -1);
  const indian = first.length <= 2 && last.length === 3 && middle.every((g) => g.length === 2);
  return western || indian;
}

/**
 * Parse a money/number token. Returns null if the text is not a number.
 * Accepts "₹ 1,200.00", "Rs.85", "2,59,110.00", "1,800.00/-", "4,25O.00".
 */
export function parseAmount(raw: string): ParsedAmount | null {
  let text = raw.trim();
  let suspicious = false;

  text = text
    .replace(RUPEE_MISREAD, "")
    .replace(/\/-$/, "")
    .replace(/\s+/g, "");

  if (!text) return null;

  // Fix letters that are clearly digits, but only in mostly-numeric tokens.
  const digitCount = (text.match(/\d/g) || []).length;
  if (digitCount >= 2 && digitCount / text.length >= 0.6 && /[OoDlIS|B]/.test(text)) {
    const fixed = text.replace(/[OoDlIS|B]/g, (c) => DIGIT_FIXES[c] ?? c);
    if (fixed !== text) {
      text = fixed;
      suspicious = true;
    }
  }

  // A comma misread as "(" ";" ":" "'" between digits: "35(400.00" → "35,400.00".
  if (/\d[(;:'`]\d/.test(text)) {
    text = text.replace(/(\d)[(;:'`](?=\d)/g, "$1,");
    suspicious = true;
  }

  const m = /^(-?)(\d[\d,]*)(\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const [, sign, intPartRaw, , decimals] = m;
  const intPart = intPartRaw.replace(/,+$/, "");
  if (!hasValidGrouping(intPart)) suspicious = true;

  const value = Number(`${sign}${intPart.replace(/,/g, "")}${decimals ? "." + decimals : ""}`);
  if (!Number.isFinite(value)) return null;
  return { value, suspicious };
}

/** A ₹ sign read as another symbol ("X1,120.50", "¥2,59,110.00", "%1,800.00"). */
const RUPEE_MISREAD = /^(₹|rs\.?|inr|[x%¥?€£])\s*(?=\d)/i;

/** True if the token looks like money (has paise, e.g. "45,000.00", "85.00", "₹1,120.50"). */
export function looksLikeMoney(raw: string): boolean {
  return /^-?\d[\d,\s(;:'`]*\.\d{2}(\/-)?$/i.test(raw.trim().replace(RUPEE_MISREAD, ""));
}

/** A number read from a damaged OCR token, with other plausible readings. */
export interface LooseNumber {
  value: number;
  /** Other readings worth trying (e.g. "1220000" may be 12,200.00 or 1220000). */
  alts: number[];
  /** 1 = cleanly printed, lower = more guesswork in the reading. */
  quality: number;
}

const LOOSE_DIGIT_FIXES: Record<string, string> = { ...DIGIT_FIXES, s: "5", Z: "2", z: "2", g: "9" };

/**
 * Read a money value from OCR text that may be damaged. Bills print rates and amounts
 * with paise, so lost separators are put back from that:
 *   "1220000" → 12,200.00   "10 300 00" → 10,300.00   "26,101 69" → 26,101.69
 *   "20.762.71" → 20,762.71   "12.627 12PCS" → 12,627.12   "8,305.08)" → 8,305.08
 * The arithmetic checks decide whether the reading was right.
 */
export function parseLooseMoney(raw: string): LooseNumber | null {
  let t = raw.trim().replace(RUPEE_MISREAD, "").replace(/\/-$/, "");
  t = t.replace(/[A-Za-z]{2,}[|\])}!.]*$/, ""); // unit glued on the end: "12PCS", "pcs)"
  t = t.replace(/(\d)[(;:'`](?=\d{2,3}\b)/g, "$1,"); // comma misread as ( ; : '
  t = t.replace(/[|[\]{}()!"'‘’`;:_~]+/g, " ").trim();
  const digitCount = (t.match(/\d/g) || []).length;
  if (digitCount < 2) return null;
  const letters = t.replace(/[\d.,\s]/g, "");
  if (letters) {
    if (letters.length > 2 || digitCount / t.replace(/\s/g, "").length < 0.6) return null;
    t = t.replace(/[A-Za-z]/g, (c) => LOOSE_DIGIT_FIXES[c] ?? c);
    if (/[A-Za-z]/.test(t)) return null;
  }
  const compact = t.replace(/\s+/g, "");
  if (/^\d[\d,]*\.\d{2}$/.test(compact) && !/\s/.test(t)) {
    const strict = parseAmount(compact);
    if (strict) return { value: strict.value, alts: [], quality: strict.suspicious || letters ? 0.7 : 1 };
  }
  const groups = t.split(/[.,\s]+/).filter(Boolean);
  const digits = groups.join("");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  const last = groups[groups.length - 1];
  if (groups.length === 1) {
    // No separators at all: the decimal point was lost (Tally always prints paise).
    return { value: n / 100, alts: [n], quality: 0.6 };
  }
  if (last.length === 2) return { value: n / 100, alts: [], quality: 0.8 };
  if (last.length === 1) return { value: n / 10, alts: [n / 100], quality: 0.5 }; // a paise digit lost
  // "10,338" — rupees with the paise unreadable.
  if (/,\d{3}$/.test(t)) return { value: n, alts: [n / 100], quality: 0.4 };
  return { value: n / 100, alts: [n / 1000, n], quality: 0.3 };
}

/** OCR spellings of units: "pes", "pos", "PCs", "pce" → PCS. Null if not a unit. */
export function normalizeUnit(raw: string): string | null {
  const t = raw.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!t) return null;
  if (UNITS.includes(t)) return t;
  if (/^P[CEOG][S5Z]$/.test(t) || t === "PCSS") return "PCS";
  if (/^N[O0][S5]$/.test(t)) return "NOS";
  return null;
}

/** Units that count pieces (a "7 KG" inside a description is a size, not a quantity). */
export const COUNT_UNITS = new Set(["PCS", "PC", "NOS", "NO", "SET", "SETS", "UNIT", "UNITS", "PAIR", "PRS", "BOX", "PKT"]);

/** Parse "2 PCS", "2PCS", "100 MTR", "1.5KG", "2PCs|", "4 pes". Returns null if not a quantity with a unit. */
export function parseQuantityWithUnit(raw: string): { value: number; unit: string } | null {
  const m = /^(\d+(?:\.\d+)?)\s*([A-Za-z]{1,5})[.|\])}!]*$/.exec(raw.trim());
  if (!m) return null;
  const unit = normalizeUnit(m[2]);
  if (!unit) return null;
  return { value: Number(m[1]), unit };
}

/** True if the text is a unit on its own ("PCS", "Nos", "pcs|"). */
export function isUnit(raw: string): boolean {
  return normalizeUnit(raw.replace(/[.|\])}!]+$/, "")) !== null;
}

/** HSN codes are 4, 6 or 8 digits. */
export function isHsn(raw: string): boolean {
  return /^(\d{4}|\d{6}|\d{8})$/.test(raw.trim());
}

/** Percent token, e.g. "18%", "18 %", "9%". Returns the number or null. */
export function parsePercent(raw: string): number | null {
  const m = /^(\d{1,2}(?:\.\d{1,2})?)\s*%$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

/** Nearest GST slab if incl ÷ excl matches one (within rounding), else null. */
export function inferGstRate(rateIncl: number, rateExcl: number): number | null {
  if (!(rateIncl > 0) || !(rateExcl > 0)) return null;
  const pct = (rateIncl / rateExcl - 1) * 100;
  let best: number | null = null;
  let bestDiff = Infinity;
  for (const slab of GST_SLABS) {
    const diff = Math.abs(pct - slab);
    if (diff < bestDiff) {
      best = slab;
      bestDiff = diff;
    }
  }
  return bestDiff <= 0.35 ? best : null;
}

/** qty × rate ≈ amount, allowing for paise rounding (bills round the rate, not the amount). */
export function amountMatches(qty: number, rate: number, amount: number): boolean {
  return Math.abs(qty * rate - amount) <= 0.01 * qty + 0.05;
}

/** General "close enough" for totals: within ₹1 (round-off) or 0.05%. */
export function totalsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.0005);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Format for messages: 259110 → "2,59,110.00". */
export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
