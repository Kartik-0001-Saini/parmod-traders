/**
 * parseBill(): OCR words → structured bill (header, item lines, totals, checks).
 *
 * How it reads the goods table:
 *  1. Group words into rows.
 *  2. Find the heading row ("Description … HSN … Qty … Rate … Amount") and use
 *     the heading positions as column guides (no fixed pixels).
 *  3. Each row with a quantity and an amount is an item; text-only rows under
 *     an item continue its description.
 *  4. If the heading wasn't readable, recognise values by shape instead
 *     (8-digit HSN, "2 PCS", money) and work out rate vs amount by arithmetic.
 *  5. Check every line (qty × rate = amount, incl ÷ excl = a GST rate). If two
 *     values agree and one doesn't, the odd one was misread: correct it and say so.
 *  6. Read totals (qty, sub-total, CGST/SGST/IGST, grand total) and cross-check.
 */
import {
  BillCheck,
  BillLine,
  BillTotals,
  ColumnAnchor,
  ColumnRole,
  OcrPage,
  OcrWord,
  ParsedBill,
} from "./types";
import { Row, centerX, cleanWords, columnOf, findHeader, groupRows, medianHeight, rowText } from "./layout";
import {
  amountMatches,
  formatINR,
  GST_SLABS,
  inferGstRate,
  isHsn,
  isUnit,
  looksLikeMoney,
  parseAmount,
  parsePercent,
  parseQuantityWithUnit,
  round2,
  totalsMatch,
} from "./numbers";
import { readHeader } from "./header-fields";
import { productHints } from "./product-hints";

/** First word of a row that ends the goods table. */
const FOOTER_START = /^(total|sub-?total|taxable|cgst|sgst|utgst|igst|grand|round|less|amount|tax|e\.?&o)/i;

/** Raw values read from one table row, before checking. */
interface RawLine {
  sl: number | null;
  description: string;
  hsn: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  rateIncl: number | null;
  taxable: number | null;
  amount: number | null;
  gstPct: number | null;
  /** Fields whose text looked damaged. */
  suspicious: Set<string>;
  /** Money values in left→right order when no heading was available. */
  unlabeledMoney: number[] | null;
  /** The words those values came from (same order). */
  unlabeledWords: OcrWord[] | null;
  /** Column each of those values sits under, if a (partial) heading was found. */
  unlabeledRoles: (ColumnRole | null)[] | null;
  /** x position where numbers start (for telling description continuations apart). */
  firstValueX: number;
}

// ---------------------------------------------------------------------------
// Row → RawLine
// ---------------------------------------------------------------------------

function readMoney(words: OcrWord[], field: string, suspicious: Set<string>): number | null {
  if (words.length === 0) return null;
  const parsed = parseAmount(words.map((w) => w.text).join(""));
  if (!parsed) return null;
  if (parsed.suspicious || words.some((w) => w.conf < 60)) suspicious.add(field);
  return parsed.value;
}

function readQty(words: OcrWord[]): { qty: number | null; unit: string | null } {
  const text = words.map((w) => w.text).join(" ").trim();
  if (!text) return { qty: null, unit: null };
  const withUnit = parseQuantityWithUnit(text.replace(/\s+/g, " "));
  if (withUnit) return { qty: withUnit.value, unit: withUnit.unit };
  const m = /^(\d+(?:\.\d+)?)/.exec(text);
  return m ? { qty: Number(m[1]), unit: null } : { qty: null, unit: null };
}

function cleanHsn(text: string): string | null {
  // Amounts ("1,13,983.05") are never HSN codes, even though they have 8 digits.
  if (/[.,]/.test(text)) return null;
  const t = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^0-9]/g, "");
  return isHsn(t) ? t : null;
}

/** Could this text be a value of that column? */
function fitsColumn(role: ColumnRole, text: string): boolean {
  switch (role) {
    case "hsn":
      return cleanHsn(text) !== null;
    case "qty":
      return /^\d/.test(text) || isUnit(text);
    case "per":
      return isUnit(text);
    case "gstPct":
      return /\d|%/.test(text);
    default:
      return /\d/.test(text) || /^(₹|rs\.?)$/i.test(text);
  }
}

/** Read a row using the heading's column positions. */
function readRowByColumns(row: Row, anchors: ColumnAnchor[]): RawLine {
  const cells: Partial<Record<ColumnRole, OcrWord[]>> = {};
  const hasAmountColumn = anchors.some((a) => a.role === "amount");
  // Leftmost real value in the row: text left of it is still description, wherever it fell.
  const firstValueX0 = Math.min(
    ...row.words.filter((w) => cleanHsn(w.text) !== null || looksLikeMoney(w.text) || parseQuantityWithUnit(w.text)).map((w) => w.x0)
  );
  row.words.forEach((w, i) => {
    let role = columnOf(w, anchors);
    if (role === null) {
      // Past the last heading: an amount under a heading OCR didn't read, or noise.
      if (looksLikeMoney(w.text) && !hasAmountColumn) role = "amount";
      else return;
    }
    // "Sl." is narrow and centred: only the row's first word, if a small number, is the serial.
    if (role === "sl" && !(i === 0 && /^\d{1,3}\.?$/.test(w.text))) role = "description";
    // Long descriptions run past the halfway line into the HSN/Qty columns: words that don't
    // fit the column's type and sit left of the first real value are description text.
    if (role !== "description" && role !== "sl" && w.x0 < firstValueX0 && !fitsColumn(role, w.text)) role = "description";
    (cells[role] ??= []).push(w);
  });
  const suspicious = new Set<string>();
  const descWords = [...(cells.description ?? [])];

  let sl: number | null = null;
  const slText = (cells.sl ?? []).map((w) => w.text).join("");
  if (/^\d{1,3}\.?$/.test(slText)) sl = parseInt(slText, 10);
  else if (descWords.length && /^\d{1,3}\.?$/.test(descWords[0].text) && !anchors.some((a) => a.role === "sl")) {
    sl = parseInt(descWords.shift()!.text, 10);
  }

  const hsnWords = cells.hsn ?? [];
  const hsn = hsnWords.map((w) => cleanHsn(w.text)).find(Boolean) ?? null;
  const { qty, unit: qtyUnit } = readQty(cells.qty ?? []);
  const perUnit = (cells.per ?? []).find((w) => isUnit(w.text))?.text.toUpperCase() ?? null;

  const valueWords = [
    ...hsnWords, ...(cells.qty ?? []), ...(cells.rate ?? []), ...(cells.rateIncl ?? []),
    ...(cells.taxable ?? []), ...(cells.amount ?? []),
  ];
  return {
    sl,
    description: descWords.map((w) => w.text).join(" "),
    hsn,
    qty,
    unit: qtyUnit ?? perUnit,
    rate: readMoney(cells.rate ?? [], "rate", suspicious),
    rateIncl: readMoney(cells.rateIncl ?? [], "rateIncl", suspicious),
    taxable: readMoney(cells.taxable ?? [], "taxable", suspicious),
    amount: readMoney(cells.amount ?? [], "amount", suspicious),
    gstPct: parsePercent((cells.gstPct ?? []).map((w) => w.text).join("")),
    suspicious,
    unlabeledMoney: null,
    unlabeledWords: null,
    unlabeledRoles: null,
    firstValueX: valueWords.length ? Math.min(...valueWords.map((w) => w.x0)) : Infinity,
  };
}

/** Read a row by recognising values by their shape (no heading available). */
function readRowByPattern(row: Row): RawLine {
  const words = row.words;
  const suspicious = new Set<string>();
  let hsnIdx = words.findIndex((w) => /^\d{8}$/.test(cleanHsn(w.text) ?? ""));
  if (hsnIdx < 0) hsnIdx = words.findIndex((w, i) => i > 0 && cleanHsn(w.text) !== null);

  // Quantity: "2 PCS" (merged by layout) or a number followed by a unit.
  let qtyIdx = -1;
  let qty: number | null = null;
  let unit: string | null = null;
  for (let i = Math.max(0, hsnIdx + 1); i < words.length; i++) {
    const q = parseQuantityWithUnit(words[i].text);
    if (q) {
      qtyIdx = i;
      qty = q.value;
      unit = q.unit;
      break;
    }
  }

  const descEnd = hsnIdx >= 0 ? hsnIdx : qtyIdx >= 0 ? qtyIdx : words.length;
  const descWords = words.slice(0, descEnd).filter((w) => !looksLikeMoney(w.text));
  let sl: number | null = null;
  if (descWords.length && /^\d{1,3}\.?$/.test(descWords[0].text)) sl = parseInt(descWords.shift()!.text, 10);

  const after = words.slice(Math.max(descEnd, qtyIdx + 1));
  const money: number[] = [];
  const moneyWords: OcrWord[] = [];
  let gstPct: number | null = null;
  for (const w of after) {
    const pct = parsePercent(w.text);
    if (pct !== null) {
      gstPct = pct;
      continue;
    }
    if (!looksLikeMoney(w.text)) continue;
    const p = parseAmount(w.text);
    if (p) {
      money.push(p.value);
      moneyWords.push(w);
      if (p.suspicious) suspicious.add("amount");
    }
  }
  if (!unit) unit = after.find((w) => isUnit(w.text))?.text.toUpperCase() ?? null;

  const firstValue = words[hsnIdx >= 0 ? hsnIdx : qtyIdx >= 0 ? qtyIdx : words.length - 1];
  return {
    sl,
    description: descWords.map((w) => w.text).join(" "),
    hsn: hsnIdx >= 0 ? cleanHsn(words[hsnIdx].text) : null,
    qty,
    unit,
    rate: null,
    rateIncl: null,
    taxable: null,
    amount: null,
    gstPct,
    suspicious,
    unlabeledMoney: money,
    unlabeledWords: moneyWords,
    unlabeledRoles: null,
    firstValueX: firstValue ? firstValue.x0 : Infinity,
  };
}

const hasMoney = (r: RawLine) =>
  r.rate !== null || r.rateIncl !== null || r.taxable !== null || r.amount !== null || (r.unlabeledMoney?.length ?? 0) > 0;

/** Fill gaps in a column-based read with a shape-based read of the same row. */
function readRow(row: Row, anchors: ColumnAnchor[] | null): RawLine {
  if (!anchors) return readRowByPattern(row);
  // Two plain "Rate" headings (the "(incl. of Tax)" line wasn't read): columns can't say
  // which is which, so read by shape and let the GST ratio decide.
  const ambiguousRates = anchors.filter((a) => a.role === "rate").length > 1;
  const byCol = ambiguousRates ? null : readRowByColumns(row, anchors);
  if (byCol && byCol.qty !== null && hasMoney(byCol) && byCol.hsn !== null) return byCol;

  const byPat = readRowByPattern(row);
  byPat.unlabeledRoles = (byPat.unlabeledWords ?? []).map((w) => columnOf(w, anchors));
  if (!byCol) return byPat;
  if (byPat.qty !== null && (byPat.unlabeledMoney?.length ?? 0) >= 2 && (byCol.qty === null || !hasMoney(byCol))) {
    return { ...byPat, sl: byCol.sl ?? byPat.sl };
  }
  return { ...byCol, hsn: byCol.hsn ?? byPat.hsn, qty: byCol.qty ?? byPat.qty, unit: byCol.unit ?? byPat.unit };
}

// ---------------------------------------------------------------------------
// RawLine → BillLine (assign meaning, check arithmetic, fix obvious misreads)
// ---------------------------------------------------------------------------

/** Unlabeled money values → rate / rate incl / taxable / amount, using arithmetic. */
function assignByArithmetic(raw: RawLine, flags: string[]): void {
  const v = raw.unlabeledMoney ?? [];
  const q = raw.qty;
  if (v.length === 0) return;
  if (v.length === 1 || !q) {
    raw.amount = v[v.length - 1];
    if (v.length > 1) raw.rate = v[0];
    flags.push("Could not tell rate from amount — please check.");
    return;
  }
  // Find rate r and amount a with q × r ≈ a. Prefer the rightmost amount.
  let pair: [number, number] | null = null;
  for (let j = v.length - 1; j > 0 && !pair; j--)
    for (let i = j - 1; i >= 0 && !pair; i--) if (amountMatches(q, v[i], v[j])) pair = [i, j];

  if (!pair) {
    raw.rate = v[0];
    raw.amount = v[v.length - 1];
    return; // the arithmetic check below will flag it
  }
  const [ri, ai] = pair;
  raw.rate = v[ri];
  raw.amount = v[ai];
  for (let k = 0; k < v.length; k++) {
    if (k === ri || k === ai) continue;
    if (inferGstRate(v[k], raw.rate) !== null) raw.rateIncl = v[k];
    else if (raw.rate !== null && inferGstRate(raw.rate, v[k]) !== null) {
      // The amount was qty × the tax-inclusive rate; this smaller value is the before-tax rate.
      raw.rateIncl = raw.rate;
      raw.rate = v[k];
    } else if (inferGstRate(v[k], raw.amount) !== null && k > ai) {
      // Amount column includes tax; the earlier one was the taxable value.
      raw.taxable = raw.amount;
      raw.amount = v[k];
    }
  }
  // Only one rate, sitting under a "Rate (incl. of Tax)" heading.
  if (raw.rateIncl === null && raw.unlabeledRoles?.[ri] === "rateIncl") {
    raw.rateIncl = raw.rate;
    raw.rate = null;
  }
}

function resolveLine(raw: RawLine, index: number): BillLine {
  const flags: string[] = [];
  const autoFixed: string[] = [];
  const uncertain = new Set<string>(raw.suspicious);

  if (raw.unlabeledMoney) assignByArithmetic(raw, flags);

  const q = raw.qty;
  let rate = raw.rate;
  let rateIncl = raw.rateIncl;
  let taxable = raw.taxable;
  let amount = raw.amount;
  let gst = raw.gstPct;
  let amountIncludesTax: boolean | null = null;
  const verified = new Set<string>();

  if (q !== null && q > 0) {
    // --- Layout with a separate "Taxable" column: Rate × Qty = Taxable, Taxable + GST = Amount ---
    if (taxable !== null) {
      // A misread GST % ("8%" for "18%") must not "correct" a good amount: if amount ÷ taxable
      // is a real GST rate and differs from the printed one, the printed % is the misread.
      const gFromAmount = amount !== null ? inferGstRate(amount, taxable) : null;
      if (gFromAmount !== null && gFromAmount !== gst) {
        if (gst !== null) autoFixed.push(`GST ${gst}% → ${gFromAmount}% (amount ÷ taxable)`);
        gst = gFromAmount;
      } else if (gst !== null && !GST_SLABS.includes(gst)) {
        flags.push(`GST ${gst}% is not a GST rate`);
        uncertain.add("gst");
      }
      const g = gst;
      const withTax = (t: number) => round2(t * (1 + (g ?? 0) / 100));
      const rateOk = rate !== null && amountMatches(q, rate, taxable);
      const amountOk = g !== null && amount !== null && totalsMatch(withTax(taxable), amount);
      if (rateOk) verified.add("rate").add("taxable");
      if (amountOk) verified.add("taxable").add("amount");

      if (rateOk && !amountOk && g !== null && amount !== null) {
        autoFixed.push(`amount ${formatINR(amount)} → ${formatINR(withTax(taxable))} (taxable + ${g}% GST)`);
        amount = withTax(taxable);
        verified.add("amount");
      } else if (!rateOk && amountOk && rate !== null) {
        const fixedRate = round2(taxable / q);
        autoFixed.push(`rate ${formatINR(rate)} → ${formatINR(fixedRate)} (taxable ÷ qty)`);
        rate = fixedRate;
        verified.add("rate");
      } else if (!rateOk && !amountOk && rate !== null && g !== null && amount !== null && totalsMatch(withTax(round2(q * rate)), amount)) {
        autoFixed.push(`taxable ${formatINR(taxable)} → ${formatINR(round2(q * rate))} (qty × rate)`);
        taxable = round2(q * rate);
        verified.add("rate").add("taxable").add("amount");
      } else if (!rateOk && !amountOk) {
        flags.push("qty × rate ≠ taxable, and taxable + GST ≠ amount");
        uncertain.add("rate").add("taxable").add("amount");
      }
      if (amount !== null) amountIncludesTax = true;
    }
    // --- Tally layout: Rate, Rate (incl. of Tax), Amount ---
    else if (amount !== null) {
      const gstFromRates = rate !== null && rateIncl !== null ? inferGstRate(rateIncl, rate) : null;
      if (rate !== null && amountMatches(q, rate, amount)) {
        amountIncludesTax = false;
        verified.add("rate").add("amount");
        if (rateIncl !== null && gstFromRates !== null) verified.add("rateIncl");
      } else if (rateIncl !== null && amountMatches(q, rateIncl, amount)) {
        amountIncludesTax = true;
        verified.add("rateIncl").add("amount");
      } else if (rate !== null && rateIncl !== null) {
        // One of the three was misread. Which two agree?
        const rateFromAmount = round2(amount / q);
        if (inferGstRate(rateIncl, rateFromAmount) !== null) {
          autoFixed.push(`rate ${formatINR(rate)} → ${formatINR(rateFromAmount)} (amount ÷ qty)`);
          rate = rateFromAmount;
          amountIncludesTax = false;
          verified.add("rate").add("amount").add("rateIncl");
        } else if (gstFromRates !== null) {
          const fixedAmount = round2(q * rate);
          autoFixed.push(`amount ${formatINR(amount)} → ${formatINR(fixedAmount)} (qty × rate)`);
          amount = fixedAmount;
          amountIncludesTax = false;
          verified.add("rate").add("amount").add("rateIncl");
        }
      }
      if (!verified.has("amount")) {
        flags.push("qty × rate ≠ amount");
        uncertain.add("amount");
        if (rate !== null) uncertain.add("rate");
        if (rateIncl !== null) uncertain.add("rateIncl");
      }
    }
  }

  if (rate !== null && rateIncl !== null) {
    const g = inferGstRate(rateIncl, rate);
    if (g === null) {
      flags.push("rate incl. tax doesn't match any GST rate");
      uncertain.add("rateIncl");
    } else gst ??= g;
  }
  if (gst !== null && rate !== null && rateIncl === null) rateIncl = round2(rate * (1 + gst / 100));

  if (q === null) {
    flags.push("Quantity not read");
    uncertain.add("quantity");
  }
  if (amount === null) {
    flags.push("Amount not read");
    uncertain.add("amount");
  }
  if (!raw.hsn) {
    flags.push("HSN not read");
    uncertain.add("hsn");
  }
  if (!raw.description.trim()) {
    flags.push("Description not read");
    uncertain.add("description");
  }
  for (const f of Array.from(uncertain)) if (verified.has(f)) uncertain.delete(f);

  const taxableValue =
    taxable ??
    (amountIncludesTax === false ? amount : null) ??
    (q !== null && rate !== null ? round2(q * rate) : null);

  const description = raw.description.replace(/\s+/g, " ").replace(/^[|:.\-\s]+|[|:\-\s]+$/g, "");
  return {
    lineNo: raw.sl ?? index + 1,
    description,
    hsn: raw.hsn,
    quantity: q,
    unit: raw.unit,
    rateExclTax: rate,
    rateInclTax: rateIncl,
    gstRate: gst,
    amount,
    amountIncludesTax,
    taxableValue,
    hints: productHints(description),
    flags,
    uncertainFields: Array.from(new Set(Array.from(uncertain).map((f) => FIELD_NAMES[f] ?? f))),
    autoFixed,
  };
}

/** Internal field → bill_lines column name. */
const FIELD_NAMES: Record<string, string> = {
  gst: "gst_rate",
  rate: "rate_excl_tax",
  rateIncl: "rate_incl_tax",
  amount: "line_amount",
  taxable: "line_amount",
  quantity: "quantity",
  hsn: "hsn_code",
  description: "raw_description",
};

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

interface MoneyRead {
  value: number;
  raw: string;
}

function readTotals(rows: Row[]): { totals: BillTotals; unlabeled: MoneyRead[] } {
  const totals: BillTotals = {
    totalQuantity: null, subtotal: null, cgst: null, sgst: null, igst: null, roundOff: null, grandTotal: null,
  };
  const totalRows: (MoneyRead & { index: number; hasQty: boolean })[] = [];
  const unlabeled: MoneyRead[] = [];
  let firstTaxIndex = Infinity;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const text = rowText(row).toLowerCase();
    if (/in\s*words|chargeable/.test(text)) continue;
    const money: MoneyRead[] = row.words
      .filter((w) => looksLikeMoney(w.text) || /^\(?-\)?\s*\d+\.\d{2}$/.test(w.text))
      .map((w) => ({ value: parseAmount(w.text.replace(/[()]/g, ""))?.value ?? NaN, raw: w.text }))
      .filter((m) => Number.isFinite(m.value));
    const qtyWord = row.words.map((w) => parseQuantityWithUnit(w.text)).find(Boolean);
    if (qtyWord && /total/.test(text)) totals.totalQuantity = qtyWord.value;
    if (money.length === 0) continue;
    const last = money[money.length - 1];

    const isTax = /cgst|sgst|utgst|igst/.test(text) || !/[a-z]{3}/.test(text);
    if (isTax) firstTaxIndex = Math.min(firstTaxIndex, index);

    if (/round/.test(text)) totals.roundOff = /\(-\)|-\s*\d|less/.test(text) ? -Math.abs(last.value) : last.value;
    else if (/cgst/.test(text)) totals.cgst = last.value;
    else if (/sgst|utgst/.test(text)) totals.sgst = last.value;
    else if (/igst/.test(text)) totals.igst = last.value;
    else if (/taxable/.test(text)) totals.subtotal = last.value;
    else if (/grand/.test(text)) totals.grandTotal = last.value;
    else if (/total/.test(text)) totalRows.push({ ...last, index, hasQty: Boolean(qtyWord) });
    else if (!/[a-z]{3}/.test(text)) unlabeled.push(last);
  }

  // Tally prints "Total <qty> <sub-total>" above the tax lines, then "Total ₹ <grand total>" below them.
  const beforeTax = totalRows.filter((t) => t.index < firstTaxIndex);
  const afterTax = totalRows.filter((t) => t.index > firstTaxIndex);
  if (totals.subtotal === null && beforeTax.length && firstTaxIndex !== Infinity) totals.subtotal = beforeTax[0].value;
  if (totals.grandTotal === null) {
    const candidate = afterTax[afterTax.length - 1] ?? (firstTaxIndex === Infinity ? totalRows[totalRows.length - 1] : undefined);
    if (candidate) totals.grandTotal = candidate.value;
  }
  return { totals, unlabeled };
}

/**
 * "₹ 1,120.50" can be read as "31,120.50" / "21,120.50" / "71,120.50": try dropping that
 * first digit. Only used when the result then matches what the other numbers say.
 */
function withoutRupeeMisread(m: MoneyRead | number, expected: number): number | null {
  const digits = (typeof m === "number" ? m.toFixed(2) : m.raw).replace(/[^\d.,]/g, "");
  if (!/^\d.*\d/.test(digits)) return null;
  const stripped = parseAmount(digits.slice(1).replace(/^,/, ""));
  return stripped && totalsMatch(stripped.value, expected) ? stripped.value : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function parseBill(pages: OcrPage[]): ParsedBill {
  const warnings: string[] = [];
  const lines: BillLine[] = [];
  let columns: ColumnAnchor[] = [];
  let headerResult: ReturnType<typeof readHeader> | null = null;
  let totals: BillTotals | null = null;
  let unlabeledTotals: MoneyRead[] = [];
  let orphanSubtotal: number | null = null;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const words = cleanWords(page.words);
    const h = medianHeight(words);
    const rows = groupRows(words, h);
    if (pageIndex === 0) headerResult = readHeader(rows, h);

    const header = findHeader(rows, h);
    if (header) columns = header.anchors;
    else warnings.push(`Page ${pageIndex + 1}: item table heading not found — reading rows by pattern.`);

    const anchors = header ? withDescriptionColumn(header.anchors, h) : null;
    const start = header ? header.index + header.rowCount : 0;
    let end = rows.length;
    for (let i = start; i < rows.length; i++) {
      const first = rows[i].words[0]?.text ?? "";
      const hasHsn = rows[i].words.some((w) => cleanHsn(w.text)?.length === 8);
      if (FOOTER_START.test(first) && !hasHsn) {
        end = i;
        break;
      }
    }

    let lastItem: { raw: RawLine; rowY: number } | null = null;
    const raws: RawLine[] = [];
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const raw = readRow(row, anchors);
      const isItem = raw.qty !== null && hasMoney(raw);
      const isItemNoQty = raw.hsn !== null && hasMoney(raw);
      if (isItem || isItemNoQty) {
        raws.push(raw);
        lastItem = { raw, rowY: row.y };
        continue;
      }
      const textOnly = !hasMoney(raw) && raw.qty === null && raw.hsn === null && raw.description.trim().length > 0;
      const inDescArea = row.words.every((w) => centerX(w) < (lastItem?.raw.firstValueX ?? Infinity));
      if (lastItem && textOnly && inDescArea && row.y - lastItem.rowY < h * 3.5) {
        lastItem.raw.description += " " + raw.description;
        lastItem.rowY = row.y;
      } else if (!textOnly && hasMoney(raw) && raw.qty === null && raw.hsn === null && !/[a-z]{3}/i.test(raw.description)) {
        // A money-only row after the items (Tally prints the sub-total like this).
        const vals = raw.unlabeledMoney ?? [raw.amount, raw.taxable].filter((x): x is number => x !== null);
        if (vals.length) orphanSubtotal = vals[vals.length - 1];
      }
    }
    for (const raw of raws) lines.push(resolveLine(raw, lines.length));

    if (end < rows.length) {
      const t = readTotals(rows.slice(end));
      totals = t.totals;
      unlabeledTotals = t.unlabeled;
    }
  }

  const finalTotals: BillTotals = totals ?? {
    totalQuantity: null, subtotal: null, cgst: null, sgst: null, igst: null, roundOff: null, grandTotal: null,
  };
  if (finalTotals.subtotal === null && orphanSubtotal !== null) finalTotals.subtotal = orphanSubtotal;

  const checks = crossCheck(lines, finalTotals, unlabeledTotals, warnings);
  const hr = headerResult;
  if (hr) warnings.unshift(...hr.warnings);
  if (lines.length === 0) warnings.push("No item lines found.");

  return {
    header: hr?.header ?? {
      supplierName: null, supplierGstin: null, buyerName: null, buyerGstin: null,
      invoiceNumber: null, invoiceDate: null, irn: null,
    },
    lines,
    totals: finalTotals,
    computed: {
      totalQuantity: lines.reduce((s, l) => s + (l.quantity ?? 0), 0),
      subtotal: lines.every((l) => l.taxableValue !== null)
        ? round2(lines.reduce((s, l) => s + (l.taxableValue ?? 0), 0))
        : null,
    },
    checks,
    warnings,
    columns,
    pageCount: pages.length,
    source: pages[0]?.source ?? "ocr",
  };
}

/** If the heading had no readable "Description", assume the space left of the first value column. */
function withDescriptionColumn(anchors: ColumnAnchor[], h: number): ColumnAnchor[] {
  if (anchors.some((a) => a.role === "description")) return anchors;
  const sl = anchors.find((a) => a.role === "sl");
  const firstValue = anchors.find((a) => a.role !== "sl");
  if (!firstValue) return anchors;
  const x0 = (sl?.x1 ?? 0) + h;
  const x1 = Math.max(x0 + h, firstValue.x0 - h * 2);
  return [...anchors, { role: "description" as ColumnRole, x0, x1, x: (x0 + x1) / 2 }].sort((a, b) => a.x - b.x);
}

// ---------------------------------------------------------------------------
// Bill-level checks
// ---------------------------------------------------------------------------

function crossCheck(lines: BillLine[], totals: BillTotals, unlabeled: MoneyRead[], warnings: string[]): BillCheck[] {
  const checks: BillCheck[] = [];
  const sumQty = lines.reduce((s, l) => s + (l.quantity ?? 0), 0);
  const allTaxable = lines.length > 0 && lines.every((l) => l.taxableValue !== null);
  const sumTaxable = allTaxable ? round2(lines.reduce((s, l) => s + (l.taxableValue ?? 0), 0)) : null;

  if (totals.totalQuantity !== null) {
    checks.push({
      name: "Total quantity",
      ok: totals.totalQuantity === sumQty,
      detail: `lines add up to ${sumQty}, bill says ${totals.totalQuantity}`,
    });
  }

  const subtotal = totals.subtotal ?? null;
  if (subtotal !== null && sumTaxable !== null) {
    checks.push({
      name: "Sub-total (before tax)",
      ok: totalsMatch(sumTaxable, subtotal),
      detail: `lines add up to ${formatINR(sumTaxable)}, bill says ${formatINR(subtotal)}`,
    });
  }

  // Tax amounts printed without labels (Tally): two equal values = CGST + SGST.
  if (totals.cgst === null && totals.sgst === null && totals.igst === null && unlabeled.length >= 2) {
    const [a, b] = unlabeled.slice(-2);
    if (Math.abs(a.value - b.value) < 0.02) {
      totals.cgst = a.value;
      totals.sgst = b.value;
    }
  }

  // CGST and SGST are always equal (intra-state). If only one was readable, use it for both.
  if (totals.igst === null && (totals.cgst === null) !== (totals.sgst === null)) {
    const known = (totals.cgst ?? totals.sgst)!;
    const missing = totals.cgst === null ? "CGST" : "SGST";
    totals.cgst = known;
    totals.sgst = known;
    warnings.push(`${missing} not readable — assumed equal to the other half (${formatINR(known)}).`);
  }

  // Expected tax from the lines (when every line has a GST rate).
  const base = sumTaxable ?? subtotal;
  const expectedTax =
    allTaxable && lines.every((l) => l.gstRate !== null)
      ? round2(lines.reduce((s, l) => s + (l.taxableValue ?? 0) * ((l.gstRate ?? 0) / 100), 0))
      : null;

  if (totals.cgst !== null && totals.sgst !== null) {
    // Fix "₹ 1,120.50" misread as "31,120.50" when the other half shows the right value.
    const half = expectedTax !== null ? expectedTax / 2 : null;
    for (const key of ["cgst", "sgst"] as const) {
      const v = totals[key]!;
      const other = key === "cgst" ? totals.sgst! : totals.cgst!;
      const target = half ?? other;
      if (!totalsMatch(v, target)) {
        const fixed = withoutRupeeMisread(v, target);
        if (fixed !== null) {
          warnings.push(`${key.toUpperCase()} ${formatINR(v)} read as ${formatINR(fixed)} (₹ sign misread as a digit).`);
          totals[key] = fixed;
        }
      }
    }
    checks.push({
      name: "CGST = SGST",
      ok: totalsMatch(totals.cgst!, totals.sgst!),
      detail: `CGST ${formatINR(totals.cgst)}, SGST ${formatINR(totals.sgst)}`,
    });
  }

  const taxSum = (totals.cgst ?? 0) + (totals.sgst ?? 0) + (totals.igst ?? 0);
  if (taxSum > 0 && expectedTax !== null) {
    checks.push({
      name: "GST amount",
      ok: totalsMatch(taxSum, expectedTax),
      detail: `lines' GST adds up to ${formatINR(expectedTax)}, bill says ${formatINR(taxSum)}`,
    });
  } else if (taxSum > 0 && base) {
    const pct = (taxSum / base) * 100;
    const slab = GST_SLABS.find((s) => Math.abs(s - pct) <= 0.15);
    checks.push({
      name: "GST rate",
      ok: slab !== undefined,
      detail: slab !== undefined ? `tax is ${slab}% of the sub-total` : `tax is ${pct.toFixed(2)}% of the sub-total — not a GST rate`,
    });
    // Single "Rate (incl. of Tax)" column: fill the before-tax rate from the bill's GST rate.
    if (slab !== undefined) {
      for (const l of lines) {
        if (l.rateExclTax === null && l.rateInclTax !== null) {
          l.rateExclTax = round2(l.rateInclTax / (1 + slab / 100));
          l.gstRate ??= slab;
        }
      }
    }
  }

  if (totals.grandTotal !== null) {
    const pre = base ?? (lines.every((l) => l.amount !== null) ? lines.reduce((s, l) => s + (l.amount ?? 0), 0) : null);
    if (pre !== null) {
      const amountsIncludeTax = lines.length > 0 && lines.every((l) => l.amountIncludesTax === true) && base === null;
      const expected = round2(pre + (amountsIncludeTax ? 0 : taxSum) + (totals.roundOff ?? 0));
      let ok = Math.abs(expected - totals.grandTotal) <= 1.0;
      if (!ok) {
        const fixed = withoutRupeeMisread(totals.grandTotal, expected);
        if (fixed !== null) {
          warnings.push(`Grand total ${formatINR(totals.grandTotal)} read as ${formatINR(fixed)} (₹ sign misread as a digit).`);
          totals.grandTotal = fixed;
          ok = true;
        }
      }
      checks.push({
        name: "Grand total",
        ok,
        detail: `sub-total + tax = ${formatINR(expected)}, bill says ${formatINR(totals.grandTotal)}`,
      });
    }
  }
  return checks;
}
