/**
 * Bill Reader — shared data shapes.
 *
 * Pipeline:  image / PDF  →  OcrPage (words + positions)  →  parseBill()  →  ParsedBill
 *
 * Everything in lib/bill-reader is plain TypeScript with no Node-only or
 * browser-only imports (except ocr-tesseract.ts, which works in both), so the
 * same parser runs inside the app and in scripts/test-bills.ts.
 */

/** One word (or short text piece) found on the page, with its box in pixels. */
export interface OcrWord {
  text: string;
  /** 0–100. PDF text-layer words are 100. */
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** All words from one page/image. */
export interface OcrPage {
  words: OcrWord[];
  width: number;
  height: number;
  /** "ocr" = read from pixels, "pdf-text" = exact text from a digital PDF. */
  source: "ocr" | "pdf-text";
}

/** What a table column contains, decided from its heading text. */
export type ColumnRole =
  | "sl"
  | "description"
  | "hsn"
  | "qty"
  | "rate" // rate per unit, before tax
  | "rateIncl" // rate per unit, including tax ("Rate (incl. of Tax)")
  | "per"
  | "taxable" // qty × rate before tax
  | "gstPct"
  | "amount"
  | "tax" // CGST / SGST / IGST amount on the line
  | "total" // line total including tax
  | "disc"; // discount %

export interface ColumnAnchor {
  role: ColumnRole;
  /** Horizontal centre of the heading text. */
  x: number;
  x0: number;
  x1: number;
}

/** Guesses that help match a bill line to a showroom product. */
export interface ProductHints {
  brand: string | null;
  category: string | null;
  /** e.g. "1.5 Ton", "236 L", "43 inch", "7 Kg". */
  sizeSpec: string | null;
  /** Token that looks like a model number (letters + digits), if any. */
  modelCandidate: string | null;
}

/** One item row from the bill's goods table. */
export interface BillLine {
  /** Printed serial number, or position in the table if none was read. */
  lineNo: number;
  description: string;
  hsn: string | null;
  quantity: number | null;
  /** PCS, MTR, NOS, KG … */
  unit: string | null;
  rateExclTax: number | null;
  rateInclTax: number | null;
  /** GST percent, e.g. 18. Printed, or inferred from incl ÷ excl. */
  gstRate: number | null;
  /** Value printed in the "Amount" column. */
  amount: number | null;
  /** true if the Amount column includes tax, false if it is before tax, null if unknown. */
  amountIncludesTax: boolean | null;
  /** quantity × rate before tax (printed "Taxable" column, or computed). */
  taxableValue: number | null;
  hints: ProductHints;
  /** Readable problems for the owner to check, e.g. "qty × rate ≠ amount". */
  flags: string[];
  /** Field names that may be wrong (maps to bill_lines.uncertain_fields). */
  uncertainFields: string[];
  /** Corrections the parser applied, e.g. "rate 1,20.00 → 120.00 (from amount ÷ qty)". */
  autoFixed: string[];
}

export interface BillHeader {
  supplierName: string | null;
  supplierGstin: string | null;
  buyerName: string | null;
  buyerGstin: string | null;
  invoiceNumber: string | null;
  /** ISO date, yyyy-mm-dd. */
  invoiceDate: string | null;
  /** 64-character e-invoice IRN, if printed and readable. */
  irn: string | null;
}

/** Totals as printed on the bill (null if not found). */
export interface BillTotals {
  totalQuantity: number | null;
  /** Taxable value / sub-total before tax. */
  subtotal: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  roundOff: number | null;
  grandTotal: number | null;
}

export interface BillCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ParsedBill {
  header: BillHeader;
  lines: BillLine[];
  totals: BillTotals;
  /** Totals recomputed from the lines, for comparison with the printed ones. */
  computed: {
    totalQuantity: number;
    subtotal: number | null;
  };
  /** Bill-level consistency checks (qty total, sub-total, tax, grand total). */
  checks: BillCheck[];
  /** Problems that are not tied to one line, e.g. "item table heading not found". */
  warnings: string[];
  /** Columns detected from the table heading (useful when debugging a bill). */
  columns: ColumnAnchor[];
  /** Where the item table sits on each page (page coordinates), for a zoomed second read. */
  tableRegions: { page: number; y0: number; y1: number; itemsEnd: number }[];
  pageCount: number;
  source: OcrPage["source"];
}
