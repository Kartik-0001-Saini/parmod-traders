/**
 * parseBill(): OCR words → structured bill (header, item lines, totals, checks).
 *
 * How it reads the goods table:
 *  1. Straighten the page (phone photos are tilted / curved) and group words into rows.
 *  2. Find the heading row ("Description … HSN … Qty … Rate … Amount"). If it is
 *     unreadable, start at the first row that looks like an item (HSN + qty/amount).
 *  3. Rows with an HSN / quantity and numbers are items; text-only rows under an item
 *     continue its description; "Batch :" rows are skipped.
 *  4. Each item's numbers go to the line solver (line-solver.ts), which finds the
 *     reading where qty × rate, rate incl. tax, amount, taxable, CGST/SGST and total
 *     all agree, and corrects the numbers that don't.
 *  5. Bill-level fixes: GST rate from the other lines; one unreadable line from the
 *     sub-total minus the other lines.
 *  6. Read totals (qty, sub-total, CGST/SGST/IGST, round-off, grand total) and cross-check.
 */
import { BillCheck, BillLine, BillTotals, ColumnAnchor, ColumnRole, OcrPage, OcrWord, ParsedBill } from "./types";
import { Row, cleanWords, findHeader, groupRows, medianHeight, rowText } from "./layout";
import { formatINR, GST_SLABS, looksLikeMoney, parseAmount, parseLooseMoney, parseQuantityWithUnit, round2, totalsMatch } from "./numbers";
import { HeaderOptions, readHeader } from "./header-fields";
import { productHints } from "./product-hints";
import { straighten } from "./straighten";
import { ItemRow, cleanHsn, looksLikeItemRow, readItemRow } from "./table";
import { LineSolution, solveLine } from "./line-solver";

/** Row labels that end the goods table (after normalising OCR damage, see labelText). */
const FOOTER_LABEL = /^(total|subtotal|taxable|cgst|sgst|utgst|igst|grand|round|less|amount|tax|eoe|coin|continued)/;

/**
 * Lower-case letters of a row label with common OCR damage undone:
 * "C.G.5.T|" → "cgst", "S.G.ST" → "sgst", "R0UND" → "round".
 */
function labelText(text: string): string {
  const t = text
    .toLowerCase()
    .replace(/[.|_:;'"`,]/g, "")
    .replace(/(?<=[a-z])5|5(?=[a-z])/g, "s")
    .replace(/(?<=[a-z])0|0(?=[a-z])/g, "o")
    .replace(/(?<=[a-z])7|7(?=[a-z])/g, "t")
    .replace(/\s+/g, " ")
    .trim();
  // One wrong letter in a tax label: "sgsr" / "cgsy" / "sgs7" → sgst / cgst.
  return t.replace(/\b([cs]gs[a-z]|[cs]g[a-z]t|igs[a-z])\b/g, (m) => m.slice(0, 3) + "t").replace(/\b(sgst|cgst|igst)[a-z]\b/g, "$1");
}

function isFooterRow(row: Row): boolean {
  const first = labelText(row.words.slice(0, 2).map((w) => w.text).join("")).replace(/\s/g, "");
  const hasHsn = row.words.some((w) => cleanHsn(w.text)?.length === 8);
  if (hasHsn) return false;
  if (/in ?words|chargeable|continued/.test(labelText(rowText(row)))) return true;
  // Allow a stray mark before the label ("Cc.G.S.T" → "ccgst").
  return FOOTER_LABEL.test(first) || FOOTER_LABEL.test(first.slice(1)) || /^.?(c|s|i)gst/.test(first);
}

// ---------------------------------------------------------------------------
// Item rows → lines
// ---------------------------------------------------------------------------

interface Item {
  row: ItemRow;
  description: string;
  y: number;
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

function toLine(item: Item, sol: LineSolution, index: number): BillLine {
  const flags = [...sol.flags];
  const uncertain = new Set(sol.uncertain);
  const description = item.description.replace(/\s+/g, " ").replace(/^[|:.\-\s[\]]+|[|:\-\s[\]]+$/g, "");
  if (!item.row.hsn) {
    flags.push("HSN not read");
    uncertain.add("hsn");
  }
  if (!description) {
    flags.push("Description not read");
    uncertain.add("description");
  }
  return {
    lineNo: item.row.sl ?? index + 1,
    description,
    hsn: item.row.hsn,
    quantity: sol.quantity,
    unit: item.row.unit,
    rateExclTax: sol.rateExclTax,
    rateInclTax: sol.rateInclTax,
    gstRate: sol.gstRate,
    amount: sol.amount,
    amountIncludesTax: sol.amountIncludesTax,
    taxableValue: sol.taxableValue,
    hints: productHints(description),
    flags,
    uncertainFields: Array.from(new Set(Array.from(uncertain).map((f) => FIELD_NAMES[f] ?? f))),
    autoFixed: sol.autoFixed,
  };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

interface MoneyRead {
  value: number;
  raw: string;
}

function moneyOf(text: string): MoneyRead | null {
  const clean = text.replace(/[()]/g, "");
  if (looksLikeMoney(clean) || /^\(?-\)?\s*\d+\.\d{2}$/.test(text)) {
    const v = parseAmount(clean.replace(/^-/, ""))?.value;
    if (v !== undefined && Number.isFinite(v)) return { value: v, raw: text };
  }
  const loose = parseLooseMoney(text);
  return loose && loose.quality >= 0.8 ? { value: loose.value, raw: text } : null;
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
    const text = labelText(rowText(row));
    // The HSN-wise tax summary below "Amount Chargeable (in words)" repeats the totals
    // in a different layout — stop before it.
    if (/in ?words|chargeable/.test(text)) break;
    const money: MoneyRead[] = [];
    row.words.forEach((w, i) => {
      if (/^(₹|rs\.?)$/i.test(w.text)) return;
      const m = moneyOf(w.text);
      if (m) money.push({ ...m, raw: (row.words[i - 1] && /^(₹|rs\.?)$/i.test(row.words[i - 1].text) ? "₹" : "") + m.raw });
    });
    const qtyWord = row.words.map((w) => parseQuantityWithUnit(w.text)).find(Boolean);
    if (qtyWord && /total/.test(text)) totals.totalQuantity = qtyWord.value;
    if (money.length === 0) continue;
    const last = money[money.length - 1];

    const isTax = /cgst|sgst|sgsy|utgst|igst/.test(text) || !/[a-z]{3}/.test(text);
    if (isTax) firstTaxIndex = Math.min(firstTaxIndex, index);

    if (/round|coin ?adj/.test(text)) totals.roundOff = /\(-\)|-\s*\d|less/.test(text) ? -Math.abs(last.value) : last.value;
    else if (/cgst/.test(text)) totals.cgst = last.value;
    else if (/sgst|sgsy|utgst/.test(text)) totals.sgst = last.value;
    else if (/igst/.test(text)) totals.igst = last.value;
    else if (/taxable/.test(text)) totals.subtotal = last.value;
    else if (/grand/.test(text)) totals.grandTotal = last.value;
    else if (/total/.test(text)) {
      // "Total 6 pcs ₹ 89,000.00 75,423.72 6,788.13 …": the ₹ figure (or the largest) is the total.
      const main = money.find((m) => m.raw.startsWith("₹")) ?? money.reduce((a, b) => (b.value > a.value ? b : a));
      totalRows.push({ ...main, index, hasQty: Boolean(qtyWord) });
    } else if (!/[a-z]{3}/.test(text)) unlabeled.push(last);
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

export type ParseOptions = HeaderOptions;

export function parseBill(pages: OcrPage[], options: ParseOptions = {}): ParsedBill {
  const warnings: string[] = [];
  const items: Item[] = [];
  const solutions: LineSolution[] = [];
  let columns: ColumnAnchor[] = [];
  let headerResult: ReturnType<typeof readHeader> | null = null;
  let totals: BillTotals | null = null;
  let unlabeledTotals: MoneyRead[] = [];
  let orphanSubtotal: number | null = null;
  let continued = false;
  const tableRegions: ParsedBill["tableRegions"] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const cleaned = cleanWords(page.words);
    const h = medianHeight(cleaned);
    const words = page.source === "ocr" ? straighten(cleaned, h).words : cleaned;
    const originalOf = new Map<OcrWord, OcrWord>(words.map((w, i) => [w, cleaned[i]]));
    const rows = groupRows(words, h);
    if (pageIndex === 0) headerResult = readHeader(rows, h, options);
    if (rows.some((r) => /continued/.test(labelText(rowText(r))))) continued = true;

    const header = findHeader(rows, h);
    if (header) columns = header.anchors;
    const anchors = header ? withDescriptionColumn(header.anchors, h) : null;
    let start = header ? header.index + header.rowCount : rows.findIndex(looksLikeItemRow);
    if (!header) {
      warnings.push(`Page ${pageIndex + 1}: item table heading not found — reading rows by pattern.`);
      if (start < 0) start = rows.length;
      // The first item may have a damaged HSN: look back a few rows for item-like rows.
      for (let k = start - 1; k >= 0 && k >= start - 3; k--) {
        if (readItemRow(rows[k], null, h).kind !== "item") break;
        start = k;
      }
    }
    let end = rows.length;
    for (let i = start; i < rows.length; i++) {
      if (isFooterRow(rows[i])) {
        end = i;
        break;
      }
    }

    // Where the table sits (heading → end of the totals), in the page's own coordinates.
    const itemsBefore = items.length;
    const regionStart = header ? header.index : start;

    let last: Item | null = null;
    for (let i = start; i < end; i++) {
      const r = readItemRow(rows[i], anchors, h);
      if (r.kind === "item") {
        last = { row: r, description: r.description, y: r.y };
        items.push(last);
        continue;
      }
      if (r.kind === "text" && last && r.y - last.y < h * 3.5) {
        const inDescArea = rows[i].words.every((w) => w.x0 < (last as Item).row.firstValueX);
        if (inDescArea) {
          last.description += " " + r.description;
          last.y = r.y;
        }
      } else if (r.kind === "batch" && last) {
        last.y = r.y; // keep description continuations below batch lines attached
      } else if (r.kind === "money" && items.length > 0) {
        // A money-only row after the items (Tally prints the sub-total like this).
        const best = r.obs.values.reduce((a, b) => (b.quality > a.quality || (b.quality === a.quality && b.value > a.value) ? b : a));
        if (best.quality >= 0.8) orphanSubtotal = best.value;
      }
    }

    if (end < rows.length) {
      const t = readTotals(rows.slice(end));
      totals = t.totals;
      unlabeledTotals = t.unlabeled;
    }

    if (items.length > itemsBefore && regionStart < rows.length) {
      let regionEnd = rows.findIndex((r, i) => i >= end && /in ?words|chargeable|continued/.test(labelText(rowText(r))));
      if (regionEnd < 0) regionEnd = Math.min(rows.length - 1, end + 8);
      const orig = (r: Row) => r.words.map((w) => originalOf.get(w) ?? w);
      const ys = rows.slice(regionStart, regionEnd + 1).flatMap(orig).flatMap((w) => [w.y0, w.y1]);
      const footerTop = end < rows.length ? Math.min(...orig(rows[end]).map((w) => (w.y0 + w.y1) / 2)) : Math.max(...ys);
      tableRegions.push({ page: pageIndex, y0: Math.min(...ys), y1: Math.max(...ys), itemsEnd: footerTop });
    }
  }

  for (const item of items) solutions.push(solveLine(item.row.obs));

  const finalTotals: BillTotals = totals ?? {
    totalQuantity: null, subtotal: null, cgst: null, sgst: null, igst: null, roundOff: null, grandTotal: null,
  };
  if (finalTotals.subtotal === null && orphanSubtotal !== null) {
    // A money-only row under the items is the sub-total only if it is in the right range
    // (a half-read "3,99,491.47" → "491.47" is not).
    // Compare with the lines whose numbers agreed (a misread line would skew the sum).
    const strong = solutions.filter((s) => s.taxableValue !== null && s.support >= 2 && !s.estimated);
    const sumStrong = strong.reduce((a, s) => a + (s.taxableValue ?? 0), 0);
    const allStrong = strong.length === solutions.length;
    const plausible =
      strong.length === 0 ||
      (allStrong
        ? Math.abs(orphanSubtotal - sumStrong) <= sumStrong * 0.2
        : orphanSubtotal >= sumStrong - 1 && orphanSubtotal <= sumStrong * 2);
    if (plausible) finalTotals.subtotal = orphanSubtotal;
  }

  fillFromBill(solutions, finalTotals);
  const lines = items.map((item, i) => toLine(item, solutions[i], i));
  // Serial numbers: keep the printed ones if they only go up. If they jump around (a margin
  // tick read as "20"), number the lines by the offset most of them agree on.
  const sls = items.map((it) => it.row.sl);
  const increasing = sls.every((s, i) => s !== null && (i === 0 || s > (sls[i - 1] as number)));
  if (!increasing) {
    const offsets = new Map<number, number>();
    sls.forEach((s, i) => s !== null && offsets.set(s - i, (offsets.get(s - i) ?? 0) + 1));
    const offset = Array.from(offsets.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
    lines.forEach((l, i) => (l.lineNo = i + Math.max(1, offset)));
  }

  const checks = crossCheck(lines, finalTotals, unlabeledTotals, warnings);
  const hr = headerResult;
  if (hr) warnings.unshift(...hr.warnings);
  if (continued) warnings.push('Bill says "continued to next page" — add the next page as well.');
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
    tableRegions,
    pageCount: pages.length,
    source: pages[0]?.source ?? "ocr",
  };
}

/**
 * Fixes that need the whole bill:
 *  - a line whose GST rate couldn't be proven takes the rate the other lines agree on;
 *  - one line that couldn't be read is the sub-total minus all the other lines.
 */
function fillFromBill(sols: LineSolution[], totals: BillTotals): void {
  const counts = new Map<number, number>();
  for (const s of sols) if (s.gstFromLine && s.gstRate !== null) counts.set(s.gstRate, (counts.get(s.gstRate) ?? 0) + 1);
  const majority = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  if (majority !== null) {
    for (const s of sols) {
      if (s.gstRate !== null) continue;
      if (s.rateExclTax !== null && s.rateInclTax === null) {
        s.gstRate = majority;
        s.rateInclTax = round2(s.rateExclTax * (1 + majority / 100));
      } else if (s.rateInclTax !== null && s.rateExclTax === null && s.quantity) {
        s.gstRate = majority;
        s.rateExclTax = round2(s.rateInclTax / (1 + majority / 100));
        s.taxableValue = round2((s.quantity * s.rateInclTax) / (1 + majority / 100));
      }
    }
  }

  // One weak line + a known sub-total → that line is the difference.
  const subtotal = totals.subtotal;
  const weak = sols.filter((s) => s.support <= 1 || s.taxableValue === null || s.estimated);
  if (subtotal !== null && weak.length === 1 && sols.length > 1) {
    const w = weak[0];
    const others = sols.filter((s) => s !== w);
    if (others.every((s) => s.taxableValue !== null)) {
      const rest = round2(subtotal - others.reduce((a, s) => a + (s.taxableValue ?? 0), 0));
      const g = w.gstRate ?? majority;
      if (rest > 0 && w.quantity && (w.taxableValue === null || Math.abs(rest - w.taxableValue) > 0.009)) {
        const before = w.taxableValue;
        w.taxableValue = rest;
        w.rateExclTax = round2(rest / w.quantity);
        if (g !== null) {
          w.gstRate = g;
          w.rateInclTax = round2(w.rateExclTax * (1 + g / 100));
        }
        if (!w.amountIncludesTax) w.amount = rest;
        else if (g !== null) w.amount = round2(rest * (1 + g / 100));
        w.autoFixed.push(
          before === null
            ? `amount ${formatINR(rest)} = sub-total − other lines`
            : `amount ${formatINR(before)} → ${formatINR(rest)} (sub-total − other lines)`
        );
        w.flags = w.flags.filter((f) => !/one number|don't agree|worked out/.test(f));
        w.uncertain = w.uncertain.filter((f) => f !== "amount" && f !== "rate" && f !== "rateIncl");
        w.estimated = false;
      } else if (w.taxableValue !== null && Math.abs(rest - w.taxableValue) <= 0.009) {
        // The sub-total confirms the weak line.
        w.flags = w.flags.filter((f) => !/one number|don't agree|worked out/.test(f));
        w.uncertain = w.uncertain.filter((f) => f !== "amount" && f !== "rate" && f !== "rateIncl");
        w.estimated = false;
      }
    }
  }
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
