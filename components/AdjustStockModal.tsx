"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Boxes,
  Plus,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { ProductItem } from "@/lib/mock-data";
import { executeStockChange } from "@/lib/services/inventory-service";

interface AdjustStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: ProductItem[];
  initialProduct?: ProductItem | null;
  onStockAdjusted: () => void;
}

export function AdjustStockModal({
  isOpen,
  onClose,
  products,
  initialProduct,
  onStockAdjusted,
}: AdjustStockModalProps) {
  const { lang } = useLanguage();
  const isHindi = lang === "hi";

  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [adjustQty, setAdjustQty] = useState<number>(1);
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [reason, setReason] = useState<"stock_count" | "sale" | "return" | "manual_correction">("stock_count");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialProduct) {
      setSelectedProductId(initialProduct.id);
      setProductSearch(initialProduct.modelNumber);
    } else if (products.length > 0 && !selectedProductId) {
      setSelectedProductId(products[0].id);
    }
  }, [initialProduct, products, selectedProductId]);

  if (!isOpen) return null;

  const currentProduct = products.find((p) => p.id === selectedProductId) || initialProduct;
  const currentStock = currentProduct ? currentProduct.currentStock : 0;
  const changeQty = direction === "add" ? adjustQty : -adjustQty;
  const newProjectedStock = Math.max(0, currentStock + changeQty);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!currentProduct) {
      setErrorMsg(isHindi ? "कृपया कोई सामान चुनें" : "Please select an item");
      return;
    }

    if (adjustQty <= 0) {
      setErrorMsg(isHindi ? "कृपया 1 या उससे ज्यादा पीस डालें" : "Quantity must be at least 1");
      return;
    }

    if (direction === "remove" && adjustQty > currentStock) {
      setErrorMsg(
        isHindi
          ? `दुकान में केवल ${currentStock} पीस हैं। आप ${adjustQty} नहीं निकाल सकते!`
          : `Only ${currentStock} units in stock. Cannot remove ${adjustQty}!`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await executeStockChange({
        variantId: currentProduct.id,
        changeQty,
        reason,
        notes: notes.trim() || (direction === "add" ? "Stock Inward / Delivery" : "Stock Correction"),
      });

      if (!res.success) {
        setErrorMsg(res.error || "Failed to update stock");
        return;
      }

      onStockAdjusted();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center">
              <Boxes className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">
                {isHindi ? "स्टॉक जोड़ें / सुधारें (Add Stock)" : "Adjust Shop Stock"}
              </h2>
              <p className="text-xs text-emerald-100 font-medium">
                {isHindi
                  ? "नया माल दुकान में आने पर यहाँ से स्टॉक बढ़ाएं"
                  : "Safely record new incoming deliveries or stock corrections"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Select Product */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isHindi ? "सामान चुनें (Select Item) *" : "Select Item *"}
            </label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand} {p.name} ({p.modelNumber}) — Stock: {p.currentStock}
                </option>
              ))}
            </select>
          </div>

          {/* Product Summary Preview Card */}
          {currentProduct && (
            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-900">{currentProduct.brand} {currentProduct.name}</p>
                <p className="text-[11px] text-slate-500 font-mono">
                  Model: {currentProduct.modelNumber} | HSN: {currentProduct.hsnCode}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-bold block">
                  {isHindi ? "वर्तमान स्टॉक" : "Current Stock"}
                </span>
                <span className="text-base font-black text-slate-800">
                  {currentStock} {isHindi ? "पीस" : "units"}
                </span>
              </div>
            </div>
          )}

          {/* Add or Remove Toggle */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isHindi ? "क्या करना चाहते हैं?" : "Action Type"}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setDirection("add");
                  setReason("stock_count");
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all ${
                  direction === "add"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <Plus className="w-4 h-4" />
                <span>{isHindi ? "+ स्टॉक जोड़ें (New Inward)" : "+ Add Units"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDirection("remove");
                  setReason("manual_correction");
                }}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-bold text-xs transition-all ${
                  direction === "remove"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <Minus className="w-4 h-4" />
                <span>{isHindi ? "- स्टॉक घटाएं (Correction)" : "- Remove Units"}</span>
              </button>
            </div>
          </div>

          {/* Quantity Selector with Quick Buttons */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isHindi ? "कितने पीस? (Quantity) *" : "Quantity (Units) *"}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={adjustQty}
                onChange={(e) => setAdjustQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-24 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-center text-base font-black text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />

              {/* Quick Pills */}
              <div className="flex items-center gap-1">
                {[1, 2, 5, 10].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setAdjustQty(num)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                      adjustQty === num
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                    }`}
                  >
                    +{num}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Live Result Preview */}
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-center justify-between text-xs font-bold">
            <span>{isHindi ? "नया स्टॉक होगा:" : "New Stock will be:"}</span>
            <span className="text-base font-black text-emerald-800">
              {currentStock} → {newProjectedStock} {isHindi ? "पीस" : "units"}
            </span>
          </div>

          {/* Reason & Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isHindi ? "कारण या सप्लायर का बिल नंबर" : "Reason / Notes"}
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isHindi
                  ? "जैसे: गोदरेज से 5 पीस की नई डिलीवरी आई"
                  : "e.g. Received new stock from Godrej distributor"
              }
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
            >
              {isHindi ? "रद्द करें" : "Cancel"}
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all active:scale-95 shadow-md shadow-emerald-600/25"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isHindi ? "सेव हो रहा है..." : "Saving..."}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isHindi ? "स्टॉक अपडेट करें" : "Update Stock"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
