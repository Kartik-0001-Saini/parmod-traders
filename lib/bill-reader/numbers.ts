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
    .replace(/^(₹|rs\.?|inr)\s*/i, "")
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

/** True if the token looks like money (has paise, e.g. "45,000.00", "85.00"). */
export function looksLikeMoney(raw: string): boolean {
  return /^(₹|rs\.?)?\s*-?\d[\d,\s(;:'`]*\.\d{2}(\/-)?$/i.test(raw.trim());
}

/** Parse "2 PCS", "2PCS", "100 MTR", "1.5KG". Returns null if not a quantity with a unit. */
export function parseQuantityWithUnit(raw: string): { value: number; unit: string } | null {
  const m = /^(\d+(?:\.\d+)?)\s*([A-Za-z]{1,5})\.?$/.exec(raw.trim());
  if (!m) return null;
  const unit = m[2].toUpperCase();
  if (!UNITS.includes(unit)) return null;
  return { value: Number(m[1]), unit };
}

/** True if the text is a unit on its own ("PCS", "Nos"). */
export function isUnit(raw: string): boolean {
  return UNITS.includes(raw.trim().replace(/\.$/, "").toUpperCase());
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
