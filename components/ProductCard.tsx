"use client";

import React from "react";
import { AlertTriangle, Clock, ShoppingCart, RotateCcw, CheckCircle2, Pencil } from "lucide-react";
import { ProductItem } from "@/lib/mock-data";
import { useLanguage } from "@/lib/language-context";
import { formatRupees, getDaysAgo } from "@/lib/utils";

interface ProductCardProps {
  product: ProductItem;
  mode: "check" | "update";
  onSellOne: (product: ProductItem) => void;
  onReturnOne: (product: ProductItem) => void;
}

export function ProductCard({
  product,
  mode,
  onSellOne,
  onReturnOne,
}: ProductCardProps) {
  const { lang, t } = useLanguage();

  // Stock status logic
  const isOutOfStock = product.currentStock <= 0;
  const isLowStock = product.currentStock > 0 && product.currentStock <= product.lowStockThreshold;

  // Verification freshness logic: show gentle yellow badge if >= 7 days
  const freshness = getDaysAgo(product.lastVerifiedDate);
  const needsVerification = freshness.days >= 7;

  // Savings calculation (MRP - Selling Price)
  const savings = Math.max(0, product.mrp - product.sellingPrice);

  return (
    <div className="group relative bg-white rounded-2xl border border-slate-200/90 hover:border-slate-300 shadow-xs hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col justify-between">
      {/* Top Section: Category & Verification Warning */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between gap-1.5 mb-2">
          {/* Brand & Category */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
              {product.brand}
            </span>
            {mode === "update" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-md">
                <Pencil className="w-2.5 h-2.5" />
                {lang === "hi" ? "एडिट" : "Edit"}
              </span>
            )}
          </div>

          {/* Model Number Badge - High prominence for showroom matching */}
          <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
            {product.modelNumber}
          </span>
        </div>

        {/* Product Name */}
        <h3 className="font-bold text-slate-900 text-base leading-snug group-hover:text-emerald-700 transition-colors">
          {product.name}
        </h3>

        {/* Variant / Subtitle */}
        <p className="text-xs text-slate-500 font-medium mt-0.5 leading-tight">
          {product.variant}
        </p>

        {/* Key Specs tags */}
        <div className="flex flex-wrap gap-1 mt-2.5">
          {Object.entries(product.specifications).slice(0, 3).map(([key, value]) => (
            <span
              key={key}
              className="text-[10px] bg-slate-50 text-slate-600 border border-slate-100 px-1.5 py-0.5 rounded-sm"
            >
              <strong className="text-slate-700">{key}:</strong> {value}
            </span>
          ))}
        </div>
      </div>

      {/* Middle Section: Stock Status + Freshness badge */}
      <div className="px-4 py-2 bg-slate-50/70 border-t border-b border-slate-100 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {/* Color-coded stock pill */}
            {isOutOfStock ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
                {t.outOfStock} (0)
              </span>
            ) : isLowStock ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-600" />
                {t.lowStock}: {product.currentStock}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                {t.inStock}: {product.currentStock}
              </span>
            )}
          </div>

          {/* Last verified label */}
          <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>{lang === "hi" ? freshness.labelHi : freshness.labelEn}</span>
          </div>
        </div>

        {/* 7+ Days Verification Warning Badge */}
        {needsVerification && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>{t.verifyWarning}</span>
          </div>
        )}
      </div>

      {/* Bottom Section: Pricing & Fast Action Buttons */}
      <div className="p-4 pt-3 bg-white">
        {/* Price Row */}
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              {t.sellingPrice}
            </span>
            <span className="text-xl font-extrabold text-slate-900 tracking-tight">
              {formatRupees(product.sellingPrice)}
            </span>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              {t.mrp}
            </span>
            <div className="flex items-center gap-1 justify-end">
              <span className="text-xs text-slate-400 line-through">
                {formatRupees(product.mrp)}
              </span>
              {savings > 0 && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                  {t.saveRupees} {formatRupees(savings)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons: "Sold 1" and "Return +1" */}
        <div className="grid grid-cols-2 gap-2">
          {/* Sold 1 Button */}
          <button
            onClick={() => onSellOne(product)}
            disabled={isOutOfStock}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs transition-all duration-150 active:scale-95 shadow-xs ${
              isOutOfStock
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 hover:shadow-md"
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>{t.soldOneBtn}</span>
          </button>

          {/* Return +1 Button */}
          <button
            onClick={() => onReturnOne(product)}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl font-bold text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all duration-150 active:scale-95 border border-slate-200/80"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
            <span>{t.returnOneBtn}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
