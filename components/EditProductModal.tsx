"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Lock,
  Pencil,
  Plus,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { ProductItem } from "@/lib/mock-data";
import { updateProductVariantDetails } from "@/lib/services/inventory-service";

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: ProductItem | null;
  currentCost?: number | null;
  onProductUpdated: () => void;
}

export function EditProductModal({
  isOpen,
  onClose,
  product,
  currentCost,
  onProductUpdated,
}: EditProductModalProps) {
  const { lang } = useLanguage();
  const isHindi = lang === "hi";

  const [modelNumber, setModelNumber] = useState("");
  const [hsnCode, setHsnCode] = useState("8450");
  const [variantName, setVariantName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("2");
  const [specs, setSpecs] = useState<Record<string, string>>({});

  const [customKey, setCustomKey] = useState("");
  const [customVal, setCustomVal] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setModelNumber(product.modelNumber || "");
      setHsnCode(product.hsnCode || "8450");
      setVariantName(product.variant || "");
      setSellingPrice(String(product.sellingPrice || ""));
      setMrp(String(product.mrp || ""));
      setPurchasePrice(currentCost ? String(currentCost) : "");
      setLowStockThreshold(String(product.lowStockThreshold || 2));
      setSpecs({ ...(product.specifications || {}) });
      setErrorMsg(null);
    }
  }, [product, currentCost]);

  if (!isOpen || !product) return null;

  const handleAddSpec = () => {
    if (!customKey.trim() || !customVal.trim()) return;
    setSpecs((prev) => ({
      ...prev,
      [customKey.trim()]: customVal.trim(),
    }));
    setCustomKey("");
    setCustomVal("");
  };

  const handleRemoveSpec = (key: string) => {
    setSpecs((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const numSelling = parseFloat(sellingPrice);
    if (isNaN(numSelling) || numSelling <= 0) {
      setErrorMsg(isHindi ? "कृपया सही सेलिंग प्राइस भरें" : "Please enter valid selling price");
      return;
    }

    const numMrp = parseFloat(mrp) || numSelling;
    const numPurchase = purchasePrice ? parseFloat(purchasePrice) : null;
    const numThreshold = parseInt(lowStockThreshold, 10) || 2;

    setIsSubmitting(true);
    try {
      const res = await updateProductVariantDetails({
        variantId: product.id,
        modelNumber: modelNumber.trim(),
        hsnCode: hsnCode.trim() || "8450",
        variantName: variantName.trim() || product.variant,
        attributes: specs,
        sellingPrice: numSelling,
        mrp: numMrp,
        purchasePrice: numPurchase,
        lowStockThreshold: numThreshold,
      });

      if (!res.success) {
        setErrorMsg(res.error || "Failed to update item details");
        return;
      }

      onProductUpdated();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center">
              <Pencil className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">
                {isHindi ? "सामान एडिट करें" : "Edit Showroom Product"}
              </h2>
              <p className="text-xs text-amber-100 font-medium">
                {product.brand} • {product.name}
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
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Model Number & HSN Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isHindi ? "मॉडल नंबर *" : "Model Number *"}
              </label>
              <input
                type="text"
                value={modelNumber}
                onChange={(e) => setModelNumber(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 rounded-xl font-mono uppercase text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isHindi ? "HSN कोड (Tax Group) *" : "HSN Code *"}
              </label>
              <input
                type="text"
                value={hsnCode}
                onChange={(e) => setHsnCode(e.target.value)}
                className="w-full px-3 py-2 rounded-xl font-mono text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Variant Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isHindi ? "वेरिएंट / सब-टाइटल" : "Variant Name / Subtitle"}
            </label>
            <input
              type="text"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-xs font-medium text-slate-900 bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 pt-3">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                {isHindi ? "सेलिंग प्राइस (₹) *" : "Selling Price (₹) *"}
              </label>
              <input
                type="number"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-black text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isHindi ? "MRP (काटा हुआ रेट)" : "MRP (M.R.P.)"}
              </label>
              <input
                type="number"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <div className="flex items-center gap-1 mb-1">
                <Lock className="w-3 h-3 text-amber-600" />
                <label className="text-xs font-bold text-amber-900">
                  {isHindi ? "खरीद रेट (Private)" : "Purchase Cost"}
                </label>
              </div>
              <input
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="Owner only"
                className="w-full px-3 py-2 rounded-xl bg-amber-50/70 border border-amber-300 text-xs font-bold text-amber-950 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Low stock threshold */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isHindi ? "कम स्टॉक चेतावनी लेवल" : "Low Stock Alert Threshold"}
            </label>
            <input
              type="number"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Specifications */}
          <div className="border-t border-slate-100 pt-3 flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isHindi ? "स्पेसिफिकेशन्स" : "Specifications"}
            </h3>

            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(specs).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-semibold"
                >
                  <strong>{k}:</strong> {v}
                  <button
                    type="button"
                    onClick={() => handleRemoveSpec(k)}
                    className="text-slate-400 hover:text-red-600 ml-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>

            {/* Add row */}
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder="Key (e.g. Capacity)"
                className="w-1/3 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900"
              />
              <input
                type="text"
                value={customVal}
                onChange={(e) => setCustomVal(e.target.value)}
                placeholder="Value (e.g. 8 KG)"
                className="w-1/2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900"
              />
              <button
                type="button"
                onClick={handleAddSpec}
                className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isHindi ? "जोड़ें" : "Add"}</span>
              </button>
            </div>
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
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all active:scale-95 shadow-md shadow-amber-600/25"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isHindi ? "अपडेट हो रहा है..." : "Updating..."}</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isHindi ? "बदलाव सेव करें" : "Save Changes"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
