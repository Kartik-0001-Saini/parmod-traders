"use client";

import React from "react";
import { AlertCircle, ArrowRight, Check, X } from "lucide-react";
import { ProductItem } from "@/lib/mock-data";
import { useLanguage } from "@/lib/language-context";

interface SaleConfirmDialogProps {
  isOpen: boolean;
  product: ProductItem | null;
  changeType: "sale" | "return";
  onConfirm: () => void;
  onCancel: () => void;
}

export function SaleConfirmDialog({
  isOpen,
  product,
  changeType,
  onConfirm,
  onCancel,
}: SaleConfirmDialogProps) {
  const { lang } = useLanguage();

  if (!isOpen || !product) return null;

  const currentStock = product.currentStock;
  const newStock = changeType === "sale" ? currentStock - 1 : currentStock + 1;

  const isHindi = lang === "hi";

  const title = changeType === "sale"
    ? (isHindi ? "बिक्री की पुष्टि" : "Confirm Item Sold")
    : (isHindi ? "वापसी की पुष्टि" : "Confirm Return");

  const message = isHindi
    ? `स्टॉक ${currentStock} से बदलकर ${newStock} हो जाएगा। क्या यह सही है?`
    : `Stock will go from ${currentStock} to ${newStock}. Correct?`;

  const actionText = changeType === "sale"
    ? (isHindi ? "हाँ, 1 बिक गया" : "Yes, Sold 1")
    : (isHindi ? "हाँ, 1 वापस आया" : "Yes, Return 1");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl border border-slate-100 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${
            changeType === "sale"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-blue-100 text-blue-700"
          }`}>
            <AlertCircle className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900 text-lg leading-tight">
              {title}
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              {product.brand} • {product.modelNumber}
            </p>
          </div>
        </div>

        {/* Product details card */}
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
          <p className="font-bold text-slate-900 text-sm leading-snug">
            {product.name}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {product.variant}
          </p>

          {/* Stock Transition Indicator */}
          <div className="mt-3 pt-3 border-t border-slate-200/70 flex items-center justify-center gap-3">
            <div className="text-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                {isHindi ? "वर्तमान स्टॉक" : "Current Stock"}
              </span>
              <span className="text-2xl font-black text-slate-800">
                {currentStock}
              </span>
            </div>

            <ArrowRight className="w-5 h-5 text-slate-400" />

            <div className="text-center">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                {isHindi ? "नया स्टॉक" : "New Stock"}
              </span>
              <span className={`text-2xl font-black ${
                newStock === 0 ? "text-red-600" : "text-emerald-700"
              }`}>
                {newStock}
              </span>
            </div>
          </div>
        </div>

        {/* Plain Question prompt */}
        <p className="text-center font-bold text-slate-800 text-sm">
          {message}
        </p>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            onClick={onCancel}
            className="flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors active:scale-95"
          >
            <X className="w-4 h-4" />
            <span>{isHindi ? "रद्द करें" : "Cancel"}</span>
          </button>

          <button
            onClick={onConfirm}
            className={`flex items-center justify-center gap-1.5 py-3 px-4 rounded-xl font-bold text-sm text-white transition-all duration-150 active:scale-95 shadow-md ${
              changeType === "sale"
                ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30"
                : "bg-blue-600 hover:bg-blue-700 shadow-blue-600/30"
            }`}
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>{actionText}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
