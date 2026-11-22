"use client";

/**
 * Review a read bill and add it to stock.
 *
 * Every line shows what was read (uncertain numbers highlighted, automatic fixes
 * explained) and which product it is: remembered from this supplier's earlier bills,
 * found by model number, picked by the owner, or created here as a new product.
 * "Add to stock" runs in two visible steps; if a line has a problem, that line turns red.
 */
import React, { useEffect, useMemo, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle, PackagePlus, Trash2, Undo2, ExternalLink, Sparkles, Wand2, Circle } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import type { BillRecord } from "@/lib/services/bill-service";
import { getBillSignedUrlsForPages } from "@/lib/services/bill-service";
import {
  ConfirmLineInput,
  DB_LIMITS,
  StoredBillLine,
  confirmPurchaseBill,
  fetchBillLines,
  fetchCatalogForMatching,
  fetchCategoryOptions,
  fetchSupplierMemory,
} from "@/lib/services/bill-reading-service";
import { CatalogItem, MatchType, cleanDescription, compactModel, matchByModel, proposeModelNumber, suggestProducts } from "@/lib/bill-reader/match";

interface NewProductDraft {
  categoryId: string;
  brand: string;
  name: string;
  variantName: string;
  modelNumber: string;
  sellingPrice: string;
  mrp: string;
}

interface ReviewLine {
  key: string;
  lineId: string | null;
  lineNumber: number;
  description: string;
  hsn: string;
  quantity: string;
  rateExcl: string;
  rateIncl: string;
  gst: string;
  amount: string;
  flags: string[];
  autoFixed: string[];
  uncertain: string[];
  mode: "existing" | "new";
  variantId: string;
  matchType: MatchType | null;
  product: NewProductDraft;
  removed: boolean;
}

type StepStatus = "waiting" | "running" | "done" | "failed";

const num = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

interface BillReviewModalProps {
  bill: BillRecord;
  onClose: () => void;
  /** Stock was added; the bill is confirmed. */
  onConfirmed: () => void;
}

export function BillReviewModal({ bill, onClose, onConfirmed }: BillReviewModalProps) {
  const { lang } = useLanguage();
  const hi = lang === "hi";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [supplierName, setSupplierName] = useState(bill.supplier_name === "Pending AI Extraction" ? "" : bill.supplier_name ?? "");
  const [supplierGstin, setSupplierGstin] = useState(bill.supplier_gstin ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(bill.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(bill.invoice_date ?? "");

  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [checkStep, setCheckStep] = useState<{ status: StepStatus; message: string }>({ status: "waiting", message: "" });
  const [stockStep, setStockStep] = useState<{ status: StepStatus; message: string }>({ status: "waiting", message: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ pieces: number; newProducts: number } | null>(null);

  const extracted = (bill.extracted_data ?? {}) as { checks?: { name: string; ok: boolean; detail: string }[]; warnings?: string[] };

  // ---------------------------------------------------------------------------
  // Load lines, products, supplier memory
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [stored, items, cats, memory] = await Promise.all([
          fetchBillLines(bill.id),
          fetchCatalogForMatching(),
          fetchCategoryOptions(),
          fetchSupplierMemory(bill.supplier_gstin),
        ]);
        if (!alive) return;
        setCatalog(items);
        setCategories(cats);
        setLines(stored.map((l) => toReviewLine(l, items, cats, memory)));
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bill.id, bill.supplier_gstin]);

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const sortedCatalog = useMemo(
    () => [...catalog].sort((a, b) => `${a.brand} ${a.productName} ${a.modelNumber}`.localeCompare(`${b.brand} ${b.productName} ${b.modelNumber}`)),
    [catalog]
  );

  const update = (key: string, patch: Partial<ReviewLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setLineErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const updateProduct = (key: string, patch: Partial<NewProductDraft>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, product: { ...l.product, ...patch } } : l)));
  };

  const active = lines.filter((l) => !l.removed);
  const pieces = active.reduce((s, l) => s + (num(l.quantity) ?? 0), 0);

  const viewPhoto = async () => {
    const pages = bill.pages?.length ? bill.pages : [{ page_number: 1, file_url: bill.file_url, file_hash: bill.file_hash }];
    const res = await getBillSignedUrlsForPages(pages);
    for (const p of res.signedUrls) window.open(p.url, "_blank", "noopener");
  };

  // ---------------------------------------------------------------------------
  // Add to stock: 1. check the lines  2. one all-or-nothing database call
  // ---------------------------------------------------------------------------
  const scrollToLine = (key: string) => document.getElementById(`bill-line-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  const addToStock = async () => {
    setBusy(true);
    setLineErrors({});
    setCheckStep({ status: "running", message: "" });
    setStockStep({ status: "waiting", message: "" });

    const errors: Record<string, string> = {};
    const models = new Map<string, string>();
    for (const l of active) {
      const q = num(l.quantity);
      const tooBig =
        (num(l.rateExcl) ?? 0) > DB_LIMITS.rate ||
        (num(l.rateIncl) ?? 0) > DB_LIMITS.rate ||
        (num(l.amount) ?? 0) > DB_LIMITS.amount ||
        (num(l.gst) ?? 0) > DB_LIMITS.gst ||
        [l.rateExcl, l.rateIncl, l.amount, l.gst].some((v) => (num(v) ?? 0) < 0);
      if (tooBig) errors[l.key] = hi ? "कोई रेट/राशि गलत पढ़ी गई है (बहुत बड़ी) — ठीक करें।" : "A rate or amount is misread (far too large) — correct it.";
      else if (q === null || q <= 0 || !Number.isInteger(q) || q > DB_LIMITS.quantity) errors[l.key] = hi ? "मात्रा भरें (पूरे पीस)।" : "Enter the quantity (whole pieces).";
      else if (l.mode === "existing" && !l.variantId) errors[l.key] = hi ? "प्रोडक्ट चुनें या नया बनाएं।" : "Choose the product, or create a new one.";
      else if (l.mode === "new") {
        const p = l.product;
        const model = compactModel(p.modelNumber);
        if (!p.categoryId) errors[l.key] = hi ? "नए प्रोडक्ट की कैटेगरी चुनें।" : "Choose a category for the new product.";
        else if (!p.brand.trim() || !p.name.trim()) errors[l.key] = hi ? "ब्रांड और नाम भरें।" : "Enter the brand and name.";
        else if (!model) errors[l.key] = hi ? "मॉडल नंबर भरें।" : "Enter the model number.";
        else if (!((num(p.sellingPrice) ?? 0) > 0)) errors[l.key] = hi ? "बिक्री मूल्य भरें।" : "Enter the selling price.";
        else if (catalog.some((c) => compactModel(c.modelNumber) === model))
          errors[l.key] = hi ? `मॉडल ${p.modelNumber} पहले से है — "पुराना प्रोडक्ट" में उसे चुनें।` : `Model ${p.modelNumber} already exists — pick it under "Existing product".`;
        else if (models.has(model)) errors[l.key] = hi ? `यही मॉडल लाइन ${models.get(model)} में भी है।` : `The same model is also new on line ${models.get(model)}.`;
        else models.set(model, String(l.lineNumber));
      }
    }
    if (!supplierName.trim()) {
      setCheckStep({ status: "failed", message: hi ? "सप्लायर का नाम भरें (ऊपर)।" : "Enter the supplier name (top)." });
      setBusy(false);
      return;
    }
    if (active.length === 0) {
      setCheckStep({ status: "failed", message: hi ? "कोई लाइन नहीं बची।" : "No lines left to add." });
      setBusy(false);
      return;
    }
    const bad = Object.keys(errors);
    if (bad.length) {
      setLineErrors(errors);
      setCheckStep({
        status: "failed",
        message: hi ? `${bad.length} लाइन ठीक करनी हैं — लाल रंग में दिखाई गई हैं।` : `${bad.length} line(s) need fixing — marked in red.`,
      });
      scrollToLine(bad[0]);
      setBusy(false);
      return;
    }
    setCheckStep({ status: "done", message: hi ? `${active.length} लाइनें ठीक हैं` : `${active.length} lines OK` });

    setStockStep({ status: "running", message: "" });
    const payload: ConfirmLineInput[] = active.map((l) => ({
      line_id: l.lineId,
      line_number: l.lineNumber,
      description: l.description,
      hsn_code: l.hsn.trim() || null,
      quantity: num(l.quantity),
      rate_incl_tax: num(l.rateIncl),
      rate_excl_tax: num(l.rateExcl),
      gst_rate: num(l.gst),
      line_amount: num(l.amount),
      match_type: l.mode === "new" ? "new_product" : l.matchType ?? "manual",
      variant_id: l.mode === "existing" ? l.variantId : null,
      new_product:
        l.mode === "new"
          ? {
              category_id: l.product.categoryId,
              brand: l.product.brand.trim(),
              name: l.product.name.trim(),
              variant_name: l.product.variantName.trim() || l.product.modelNumber.trim(),
              model_number: l.product.modelNumber.trim(),
              hsn_code: l.hsn.trim() || null,
              selling_price: num(l.product.sellingPrice),
              mrp: num(l.product.mrp) ?? num(l.product.sellingPrice),
            }
          : null,
    }));
    const res = await confirmPurchaseBill(
      bill.id,
      {
        supplier_name: supplierName.trim(),
        supplier_gstin: supplierGstin.trim().toUpperCase() || null,
        invoice_number: invoiceNumber.trim() || null,
        invoice_date: invoiceDate || null,
      },
      payload
    );
    if (!res.ok) {
      const line = res.line !== null ? active.find((l) => l.lineNumber === res.line) : undefined;
      if (line) {
        setLineErrors({ [line.key]: res.error.replace(/^LINE \d+:\s*/, "") });
        scrollToLine(line.key);
      }
      setStockStep({
        status: "failed",
        message: line ? (hi ? `लाइन ${line.lineNumber} में दिक्कत — कुछ भी नहीं बदला गया।` : `Problem on line ${line.lineNumber} — nothing was changed.`) : res.error,
      });
      setBusy(false);
      return;
    }
    setStockStep({
      status: "done",
      message: hi
        ? `${res.pieces} पीस स्टॉक में जुड़े${res.newProducts ? ` · ${res.newProducts} नए प्रोडक्ट` : ""}`
        : `${res.pieces} pieces added to stock${res.newProducts ? ` · ${res.newProducts} new product(s)` : ""}`,
    });
    setDone({ pieces: res.pieces, newProducts: res.newProducts });
    setBusy(false);
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const field = "w-full px-2.5 py-2 rounded-xl border text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500";
  const uncertainClass = (l: ReviewLine, f: string) => (l.uncertain.includes(f) ? "border-amber-400 bg-amber-50" : "border-slate-200");

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="relative w-full sm:max-w-3xl bg-white sm:rounded-3xl shadow-2xl border border-slate-200 overflow-hidden sm:max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-linear-to-r from-emerald-50 to-white">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900">{hi ? "बिल जांचें और स्टॉक में जोड़ें" : "Review bill & add to stock"}</h2>
            <p className="text-[11px] text-slate-500">
              {hi ? "पीली = दोबारा देखें · नीली = अपने आप सुधारा गया" : "Yellow = please check · Blue = fixed automatically"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={viewPhoto} className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1 cursor-pointer">
              <ExternalLink className="w-3.5 h-3.5" />
              {hi ? "फोटो" : "Photo"}
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center gap-2 text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              {hi ? "लाइनें और प्रोडक्ट लोड हो रहे हैं…" : "Loading lines and products…"}
            </div>
          ) : loadError ? (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">{loadError}</div>
          ) : (
            <>
              {/* Bill header */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="text-[11px] font-bold text-slate-600">
                  {hi ? "सप्लायर" : "Supplier"}
                  <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className={`${field} border-slate-200 mt-1`} />
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  GSTIN
                  <input value={supplierGstin} onChange={(e) => setSupplierGstin(e.target.value.toUpperCase())} maxLength={15} className={`${field} border-slate-200 mt-1 font-mono uppercase`} />
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  {hi ? "इनवॉइस नंबर" : "Invoice no."}
                  <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={`${field} border-slate-200 mt-1`} />
                </label>
                <label className="text-[11px] font-bold text-slate-600">
                  {hi ? "दिनांक" : "Date"}
                  <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={`${field} border-slate-200 mt-1`} />
                </label>
              </div>

              {(extracted.checks?.length || extracted.warnings?.length) ? (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 space-y-1">
                  {extracted.checks?.map((c) => (
                    <p key={c.name} className={`text-[11px] ${c.ok ? "text-emerald-700" : "text-amber-700"}`}>
                      {c.ok ? "✔" : "✘"} {c.name}: {c.detail}
                    </p>
                  ))}
                  {extracted.warnings
                    ?.filter((w) => !/heading not found/i.test(w))
                    .map((w) => (
                      <p key={w} className="text-[11px] text-slate-600">
                        • {w}
                      </p>
                    ))}
                </div>
              ) : null}

              {/* Lines */}
              {lines.map((l) => {
                const err = lineErrors[l.key];
                const chosen = l.variantId ? catalogById.get(l.variantId) : undefined;
                const suggestions = suggestProducts(l.description, l.product.brand || null, catalog);
                return (
                  <div
                    id={`bill-line-${l.key}`}
                    key={l.key}
                    className={`rounded-2xl border p-3.5 space-y-2.5 ${
                      l.removed ? "opacity-50 border-dashed border-slate-300" : err ? "border-red-400 bg-red-50/40 ring-2 ring-red-200" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-2 text-xs font-black text-slate-400 w-6 shrink-0">#{l.lineNumber}</span>
                      <input
                        value={l.description}
                        onChange={(e) => update(l.key, { description: e.target.value })}
                        className={`${field} ${uncertainClass(l, "raw_description")}`}
                        disabled={l.removed}
                      />
                      <button
                        onClick={() => update(l.key, { removed: !l.removed })}
                        title={l.removed ? (hi ? "वापस लाएं" : "Keep this line") : hi ? "यह लाइन हटाएं (गलत पढ़ी गई)" : "Remove this line (misread)"}
                        className="mt-1 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        {l.removed ? <Undo2 className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>

                    {!l.removed && (
                      <>
                        {(l.flags.length > 0 || l.autoFixed.length > 0) && (
                          <div className="flex flex-wrap gap-1.5 pl-8">
                            {l.flags.map((f) => (
                              <span key={f} className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-800 text-[10px] font-bold">
                                {f}
                              </span>
                            ))}
                            {l.autoFixed.map((f) => (
                              <span key={f} className="px-2 py-0.5 rounded-lg bg-sky-100 text-sky-800 text-[10px] font-semibold flex items-center gap-1">
                                <Wand2 className="w-3 h-3" />
                                {f}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pl-8">
                          {(
                            [
                              ["hsn", "HSN", "hsn_code"],
                              ["quantity", hi ? "मात्रा" : "Qty", "quantity"],
                              ["rateExcl", hi ? "रेट (टैक्स बिना)" : "Rate excl.", "rate_excl_tax"],
                              ["rateIncl", hi ? "रेट (टैक्स सहित)" : "Rate incl.", "rate_incl_tax"],
                              ["gst", "GST %", "gst_rate"],
                              ["amount", hi ? "राशि" : "Amount", "line_amount"],
                            ] as const
                          ).map(([k, label, f]) => (
                            <label key={k} className="text-[10px] font-bold text-slate-500">
                              {label}
                              <input
                                inputMode={k === "hsn" ? "numeric" : "decimal"}
                                value={l[k]}
                                onChange={(e) => update(l.key, { [k]: e.target.value } as Partial<ReviewLine>)}
                                className={`${field} mt-0.5 font-mono ${uncertainClass(l, f)}`}
                              />
                            </label>
                          ))}
                        </div>

                        {/* Which product */}
                        <div className="pl-8 space-y-2">
                          <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-slate-50">
                            {(["existing", "new"] as const).map((m) => (
                              <button
                                key={m}
                                onClick={() => update(l.key, { mode: m })}
                                className={`px-3 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${l.mode === m ? "bg-white shadow-xs text-slate-900" : "text-slate-500"}`}
                              >
                                {m === "existing" ? (hi ? "पुराना प्रोडक्ट" : "Existing product") : hi ? "+ नया प्रोडक्ट" : "+ New product"}
                              </button>
                            ))}
                          </div>

                          {l.mode === "existing" ? (
                            <div className="space-y-1.5">
                              <select
                                value={l.variantId}
                                onChange={(e) => update(l.key, { variantId: e.target.value, matchType: "manual" })}
                                className={`${field} border-slate-200`}
                              >
                                <option value="">{hi ? "— प्रोडक्ट चुनें —" : "— choose the product —"}</option>
                                {suggestions.length > 0 && (
                                  <optgroup label={hi ? "मिलते-जुलते" : "Looks like"}>
                                    {suggestions.map((c) => (
                                      <option key={`s-${c.id}`} value={c.id}>
                                        {c.brand} {c.productName} · {c.modelNumber} ({hi ? "स्टॉक" : "stock"} {c.currentStock})
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label={hi ? "सभी प्रोडक्ट" : "All products"}>
                                  {sortedCatalog.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.brand} {c.productName} · {c.modelNumber} ({hi ? "स्टॉक" : "stock"} {c.currentStock})
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                              {chosen && l.matchType && l.matchType !== "manual" && (
                                <p className="text-[10px] font-bold text-indigo-700 flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  {l.matchType === "memory_alias"
                                    ? hi
                                      ? "इस सप्लायर के पिछले बिल से याद रखा गया"
                                      : "Remembered from this supplier's earlier bill"
                                    : hi
                                      ? "मॉडल नंबर से मिला"
                                      : "Found by model number"}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <select
                                value={l.product.categoryId}
                                onChange={(e) => updateProduct(l.key, { categoryId: e.target.value })}
                                className={`${field} border-slate-200 col-span-2 sm:col-span-1`}
                              >
                                <option value="">{hi ? "कैटेगरी" : "Category"}</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                              <input placeholder={hi ? "ब्रांड" : "Brand"} value={l.product.brand} onChange={(e) => updateProduct(l.key, { brand: e.target.value })} className={`${field} border-slate-200`} />
                              <input placeholder={hi ? "नाम" : "Name"} value={l.product.name} onChange={(e) => updateProduct(l.key, { name: e.target.value })} className={`${field} border-slate-200 col-span-2 sm:col-span-2`} />
                              <input placeholder={hi ? "मॉडल नंबर" : "Model number"} value={l.product.modelNumber} onChange={(e) => updateProduct(l.key, { modelNumber: e.target.value })} className={`${field} border-slate-200 font-mono`} />
                              <input placeholder={hi ? "वेरिएंट (रंग/साइज़)" : "Variant (colour/size)"} value={l.product.variantName} onChange={(e) => updateProduct(l.key, { variantName: e.target.value })} className={`${field} border-slate-200`} />
                              <input inputMode="decimal" placeholder={hi ? "बिक्री मूल्य ₹" : "Selling price ₹"} value={l.product.sellingPrice} onChange={(e) => updateProduct(l.key, { sellingPrice: e.target.value })} className={`${field} border-slate-200`} />
                              <input inputMode="decimal" placeholder="MRP ₹" value={l.product.mrp} onChange={(e) => updateProduct(l.key, { mrp: e.target.value })} className={`${field} border-slate-200`} />
                            </div>
                          )}
                        </div>

                        {err && (
                          <p className="pl-8 text-xs font-bold text-red-700 flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {err}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Add to stock: two visible steps */}
        {!loading && !loadError && (
          <div className="border-t border-slate-100 p-4 space-y-2.5 bg-white">
            {checkStep.status !== "waiting" && (
              <div className="space-y-1">
                {(
                  [
                    [checkStep, hi ? "1. लाइनें जांची जा रही हैं" : "1. Checking the lines"],
                    [stockStep, hi ? "2. स्टॉक में जोड़ा जा रहा है" : "2. Adding to stock"],
                  ] as const
                ).map(([s, label]) => (
                  <div
                    key={label}
                    className={`flex items-center gap-2 text-xs font-semibold ${
                      s.status === "failed" ? "text-red-700" : s.status === "done" ? "text-emerald-700" : s.status === "running" ? "text-indigo-700" : "text-slate-400"
                    }`}
                  >
                    {s.status === "running" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : s.status === "done" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : s.status === "failed" ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <Circle className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {label}
                      {s.message ? ` — ${s.message}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {done ? (
              <button
                onClick={onConfirmed}
                className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm cursor-pointer flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {hi ? "हो गया" : "Done"}
              </button>
            ) : (
              <button
                onClick={addToStock}
                disabled={busy || active.length === 0}
                className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-bold text-sm cursor-pointer flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
                {hi
                  ? `${pieces} पीस स्टॉक में जोड़ें (${active.length} लाइन)`
                  : `Add ${pieces} piece${pieces === 1 ? "" : "s"} to stock (${active.length} line${active.length === 1 ? "" : "s"})`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A stored line → editable review line, with the product matched if possible. */
function toReviewLine(l: StoredBillLine, catalog: CatalogItem[], categories: { id: string; name: string }[], memory: Map<string, string>): ReviewLine {
  let variantId = l.matched_variant_id ?? "";
  let matchType: MatchType | null = l.match_type;
  if (!variantId) {
    const remembered = memory.get(cleanDescription(l.raw_description));
    if (remembered && catalog.some((c) => c.id === remembered)) {
      variantId = remembered;
      matchType = "memory_alias";
    } else {
      const byModel = matchByModel(l.raw_description, catalog);
      if (byModel) {
        variantId = byModel.id;
        matchType = "model_number";
      }
    }
  }
  const category = categories.find((c) => c.name.toLowerCase() === (l.category ?? "").toLowerCase());
  return {
    key: l.id,
    lineId: l.id,
    lineNumber: l.line_number,
    description: l.raw_description,
    hsn: l.hsn_code ?? "",
    quantity: str(l.quantity),
    rateExcl: str(l.rate_excl_tax),
    rateIncl: str(l.rate_incl_tax),
    gst: str(l.gst_rate),
    amount: str(l.line_amount),
    flags: l.flags ?? [],
    autoFixed: l.auto_fixed ?? [],
    uncertain: l.uncertain_fields ?? [],
    mode: variantId ? "existing" : "new",
    variantId,
    matchType,
    product: {
      categoryId: category?.id ?? "",
      brand: l.brand ?? "",
      name: l.raw_description.replace(/\s+/g, " ").trim().slice(0, 60),
      variantName: l.size_spec ?? "",
      modelNumber: proposeModelNumber(l.raw_description, l.model_candidate),
      sellingPrice: "",
      mrp: "",
    },
    removed: false,
  };
}
