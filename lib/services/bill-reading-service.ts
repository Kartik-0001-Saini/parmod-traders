/**
 * Database calls for reading a bill, reviewing it and adding it to stock.
 * The two write paths are single database functions (migration 012), so each is
 * all-or-nothing: save_bill_reading() and confirm_purchase_bill().
 */
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { BillLine, KnownSupplier, ParsedBill } from "@/lib/bill-reader";
import type { CatalogItem, MatchType } from "@/lib/bill-reader/match";
import type { BillPage, BillRecord } from "@/lib/services/bill-service";

type RpcResult = { data: unknown; error: { message: string } | null };

/** The generated DB types don't list the migration-012 functions yet; call them by name. */
async function callRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { data: null, error: { message: "Database not connected. Please check configuration." } };
  const rpc = supabase.rpc.bind(supabase) as unknown as (f: string, a: Record<string, unknown>) => Promise<RpcResult>;
  return rpc(fn, args);
}

/** Turn database error codes into plain sentences. "LINE n:" is kept so the line can be highlighted. */
export function friendlyDbError(message: string): string {
  const m = message.replace(/^.*?(?=(LINE \d+:|DUPLICATE_BILL|ALREADY_CONFIRMED|BILL_NOT_FOUND|SUPPLIER_MISSING|NO_LINES|Access Denied))/, "");
  if (/Could not find the function|function .* does not exist/i.test(message)) {
    return "The database is missing the bill functions. Run supabase/migrations/012_bill_reading_and_confirm.sql in the Supabase SQL editor.";
  }
  return m
    .replace(/^DUPLICATE_BILL:\s*/, "Already saved: ")
    .replace(/^ALREADY_CONFIRMED:\s*/, "")
    .replace(/^BILL_NOT_FOUND:\s*/, "")
    .replace(/^SUPPLIER_MISSING:\s*/, "")
    .replace(/^NO_LINES:\s*/, "");
}

/** "LINE 3: Quantity is missing." → 3 */
export function errorLineNumber(message: string): number | null {
  const m = /LINE (\d+):/.exec(message);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Files of an uploaded bill
// ---------------------------------------------------------------------------

/** Download the bill's pages from private storage (to read a bill uploaded earlier). */
export async function downloadBillFiles(bill: BillRecord): Promise<{ blob: Blob; name: string }[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Database not connected. Please check configuration.");
  const pages: BillPage[] = bill.pages?.length ? bill.pages : [{ page_number: 1, file_url: bill.file_url, file_hash: bill.file_hash }];
  const out: { blob: Blob; name: string }[] = [];
  for (const p of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    const { data, error } = await supabase.storage.from("bills").download(p.file_url);
    if (error || !data) throw new Error(`Could not download page ${p.page_number}: ${error?.message ?? "no data"}`);
    out.push({ blob: data, name: p.file_url });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 4: save what was read
// ---------------------------------------------------------------------------

function lineForDb(l: BillLine) {
  return {
    line_number: l.lineNo,
    raw_description: l.description,
    category: l.hints.category,
    brand: l.hints.brand,
    size_spec: l.hints.sizeSpec,
    model_candidate: l.hints.modelCandidate,
    hsn_code: l.hsn,
    quantity: l.quantity,
    unit: l.unit,
    rate_incl_tax: l.rateInclTax,
    rate_excl_tax: l.rateExclTax,
    line_amount: l.amount,
    taxable_value: l.taxableValue,
    amount_includes_tax: l.amountIncludesTax,
    gst_rate: l.gstRate,
    is_uncertain: l.flags.length > 0,
    uncertain_fields: l.uncertainFields,
    flags: l.flags,
    auto_fixed: l.autoFixed,
  };
}

export async function saveBillReading(billId: string, bill: ParsedBill): Promise<{ ok: true; lines: number } | { ok: false; error: string }> {
  const continued = bill.warnings.some((w) => /continued/i.test(w));
  const header = {
    supplier_name: bill.header.supplierName,
    supplier_gstin: bill.header.supplierGstin,
    invoice_number: bill.header.invoiceNumber,
    invoice_date: bill.header.invoiceDate,
    irn: bill.header.irn,
    subtotal: bill.totals.subtotal,
    cgst: bill.totals.cgst,
    sgst: bill.totals.sgst,
    igst: bill.totals.igst,
    total_pieces: bill.totals.totalQuantity,
    grand_total: bill.totals.grandTotal,
    continued,
  };
  const extracted = {
    reader: "bill-reader v2",
    read_at: new Date().toISOString(),
    header: bill.header,
    totals: bill.totals,
    checks: bill.checks,
    warnings: bill.warnings,
    page_count: bill.pageCount,
    source: bill.source,
  };
  const { data, error } = await callRpc("save_bill_reading", {
    p_bill_id: billId,
    p_header: header,
    p_lines: bill.lines.map(lineForDb),
    p_extracted: extracted,
  });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  return { ok: true, lines: (data as { lines?: number })?.lines ?? bill.lines.length };
}

// ---------------------------------------------------------------------------
// Review screen data
// ---------------------------------------------------------------------------

export interface StoredBillLine {
  id: string;
  line_number: number;
  raw_description: string;
  category: string | null;
  brand: string | null;
  size_spec: string | null;
  model_candidate: string | null;
  hsn_code: string | null;
  quantity: number | null;
  unit: string | null;
  rate_incl_tax: number | null;
  rate_excl_tax: number | null;
  line_amount: number | null;
  gst_rate: number | null;
  uncertain_fields: string[] | null;
  flags: string[] | null;
  auto_fixed: string[] | null;
  matched_variant_id: string | null;
  match_type: MatchType | null;
}

export async function fetchBillLines(billId: string): Promise<StoredBillLine[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Database not connected.");
  const { data, error } = await supabase.from("bill_lines").select("*").eq("bill_id", billId).order("line_number", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StoredBillLine[]).map((l) => ({
    ...l,
    quantity: l.quantity === null ? null : Number(l.quantity),
    rate_incl_tax: l.rate_incl_tax === null ? null : Number(l.rate_incl_tax),
    rate_excl_tax: l.rate_excl_tax === null ? null : Number(l.rate_excl_tax),
    line_amount: l.line_amount === null ? null : Number(l.line_amount),
    gst_rate: l.gst_rate === null ? null : Number(l.gst_rate),
  }));
}

/** All active products, for matching bill lines. */
export async function fetchCatalogForMatching(): Promise<CatalogItem[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Database not connected.");
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, variant_name, model_number, current_stock, products ( brand, name, category_id, categories ( name ) )")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((v: any) => ({
    id: v.id,
    modelNumber: v.model_number,
    variantName: v.variant_name,
    brand: v.products?.brand ?? "",
    productName: v.products?.name ?? "",
    categoryId: v.products?.category_id ?? null,
    categoryName: v.products?.categories?.name ?? "",
    currentStock: v.current_stock ?? 0,
  }));
}

/** clean description → product, for one supplier (what was matched on earlier bills). */
export async function fetchSupplierMemory(gstin: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !gstin) return out;
  const { data } = await supabase.from("supplier_item_aliases").select("clean_description, variant_id").eq("supplier_gstin", gstin.trim().toUpperCase());
  for (const row of data ?? []) out.set(row.clean_description, row.variant_id);
  return out;
}

export async function fetchKnownSuppliers(): Promise<KnownSupplier[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];
  const { data } = await supabase.from("suppliers").select("name, gstin").order("name");
  return (data ?? []).map((s) => ({ name: s.name, gstin: s.gstin }));
}

export async function fetchCategoryOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];
  const { data } = await supabase.from("categories").select("id, name").order("name");
  return (data ?? []) as { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Add to stock
// ---------------------------------------------------------------------------

export interface NewProductInput {
  category_id: string;
  brand: string;
  name: string;
  variant_name: string;
  model_number: string;
  hsn_code: string | null;
  selling_price: number | null;
  mrp: number | null;
}

export interface ConfirmLineInput {
  line_id: string | null;
  line_number: number;
  description: string;
  hsn_code: string | null;
  quantity: number | null;
  rate_incl_tax: number | null;
  rate_excl_tax: number | null;
  gst_rate: number | null;
  line_amount: number | null;
  match_type: MatchType | null;
  variant_id: string | null;
  new_product: NewProductInput | null;
}

export interface ConfirmHeaderInput {
  supplier_name: string;
  supplier_gstin: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
}

export async function confirmPurchaseBill(
  billId: string,
  header: ConfirmHeaderInput,
  lines: ConfirmLineInput[]
): Promise<{ ok: true; pieces: number; newProducts: number } | { ok: false; error: string; line: number | null }> {
  const { data, error } = await callRpc("confirm_purchase_bill", { p_bill_id: billId, p_header: header, p_lines: lines });
  if (error) return { ok: false, error: friendlyDbError(error.message), line: errorLineNumber(error.message) };
  const d = data as { pieces?: number; new_products?: number };
  return { ok: true, pieces: d?.pieces ?? 0, newProducts: d?.new_products ?? 0 };
}
