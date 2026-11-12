"use client";

import React from "react";
import { X, Check, ArrowDownUp } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { DynamicFilterOptions } from "@/lib/services/inventory-service";
import { SortOption } from "@/lib/sort-engine";

export type StockFilter = "all" | "in_stock" | "low_stock" | "out_of_stock" | "needs_verification";

export interface ActiveFilters {
  category: string; // 'all' or category slug
  brand: string; // 'all' or brand name
  specKey: string | null; // e.g. 'Capacity'
  specValue: string | null; // e.g. '8 KG'
  stockStatus: StockFilter;
}

interface DynamicFiltersProps {
  filterOptions: DynamicFilterOptions;
  activeFilters: ActiveFilters;
  onChangeFilters: (filters: ActiveFilters) => void;
  onResetFilters: () => void;
  totalFilteredCount: number;
  sortOption?: SortOption;
  onChangeSortOption?: (sort: SortOption) => void;
}

export function DynamicFilters({
  filterOptions,
  activeFilters,
  onChangeFilters,
  onResetFilters,
  totalFilteredCount,
  sortOption = "size_desc",
  onChangeSortOption,
}: DynamicFiltersProps) {
  const { lang, t } = useLanguage();
  const isHindi = lang === "hi";

  const hasActiveFilters =
    activeFilters.category !== "all" ||
    activeFilters.brand !== "all" ||
    activeFilters.specValue !== null ||
    activeFilters.stockStatus !== "all";

  // Stock status options
  const stockOptions: { id: StockFilter; labelEn: string; labelHi: string; icon: string }[] = [
    { id: "all", labelEn: "All Stock", labelHi: "सभी स्टॉक", icon: "📦" },
    { id: "in_stock", labelEn: "In Stock", labelHi: "दुकान में है", icon: "🟢" },
    { id: "low_stock", labelEn: "Low Stock", labelHi: "कम बचा है", icon: "🟠" },
    { id: "out_of_stock", labelEn: "Out of Stock", labelHi: "खत्म हो गया", icon: "🔴" },
    { id: "needs_verification", labelEn: "Verify (7+ Days)", labelHi: "जाँचें (7+ दिन)", icon: "⚠️" },
  ];

  // Pick the most relevant spec keys for quick filtering (Capacity, Tonnage, Screen Size, Energy Rating)
  const availableSpecKeys = Object.keys(filterOptions.specsByKey || {});
  const primarySpecKey =
    availableSpecKeys.find((k) =>
      /capacity|tonnage|screen\s*size|size/i.test(k)
    ) || availableSpecKeys[0] || null;

  const availableSpecValues = primarySpecKey ? filterOptions.specsByKey[primarySpecKey] || [] : [];

  return (
    <div className="flex flex-col gap-2.5 pt-1">
      {/* 1. Category Pills Row */}
      <div className="w-full overflow-x-auto no-scrollbar py-0.5">
        <div className="flex items-center gap-1.5 min-w-max px-0.5">
          {/* "All Items" Category Chip */}
          <button
            onClick={() =>
              onChangeFilters({
                ...activeFilters,
                category: "all",
                specKey: null,
                specValue: null,
              })
            }
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-150 active:scale-95 shadow-2xs ${
              activeFilters.category === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/90"
            }`}
          >
            <span>🏷️</span>
            <span>{t.allCategories}</span>
          </button>

          {/* Dynamic Categories from Database */}
          {filterOptions.categories.map((cat) => {
            const isSelected = activeFilters.category === cat.slug;
            return (
              <button
                key={cat.slug}
                onClick={() =>
                  onChangeFilters({
                    ...activeFilters,
                    category: cat.slug,
                    specKey: null,
                    specValue: null,
                  })
                }
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-150 active:scale-95 shadow-2xs ${
                  isSelected
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/90"
                }`}
              >
                <span>{cat.icon || "📦"}</span>
                <span>{isHindi ? cat.nameHi : cat.nameEn}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Secondary Quick Filters: Brands & Stock Status */}
      <div className="w-full overflow-x-auto no-scrollbar py-0.5">
        <div className="flex items-center gap-1.5 min-w-max px-0.5">
          {/* Clear Filters Button (shown only when any filter active) */}
          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors active:scale-95"
            >
              <X className="w-3.5 h-3.5" />
              <span>{isHindi ? "फ़िल्टर हटाएं" : "Clear All"}</span>
            </button>
          )}

          {/* Stock Status Pills */}
          {stockOptions.map((opt) => {
            const isSelected = activeFilters.stockStatus === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() =>
                  onChangeFilters({
                    ...activeFilters,
                    stockStatus: isSelected ? "all" : opt.id,
                  })
                }
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                  isSelected
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
                }`}
              >
                <span>{opt.icon}</span>
                <span>{isHindi ? opt.labelHi : opt.labelEn}</span>
                {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
              </button>
            );
          })}

          <div className="w-px h-5 bg-slate-200 mx-1 shrink-0" />

          {/* Brand Filter Pills */}
          {filterOptions.brands.map((brand) => {
            const isSelected = activeFilters.brand === brand;
            return (
              <button
                key={brand}
                onClick={() =>
                  onChangeFilters({
                    ...activeFilters,
                    brand: isSelected ? "all" : brand,
                  })
                }
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                  isSelected
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
                }`}
              >
                <span>{brand}</span>
                {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Dynamic Spec/Capacity Pills (when available for current products) */}
      {availableSpecValues.length > 0 && (
        <div className="w-full overflow-x-auto no-scrollbar py-0.5">
          <div className="flex items-center gap-1.5 min-w-max px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-0.5">
              {primarySpecKey}:
            </span>
            {availableSpecValues.map((val) => {
              const isSelected =
                activeFilters.specKey === primarySpecKey &&
                activeFilters.specValue === val;
              return (
                <button
                  key={val}
                  onClick={() =>
                    onChangeFilters({
                      ...activeFilters,
                      specKey: isSelected ? null : primarySpecKey,
                      specValue: isSelected ? null : val,
                    })
                  }
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all active:scale-95 ${
                    isSelected
                      ? "bg-emerald-700 text-white"
                      : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  <span>{val}</span>
                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Results Count & Sorting Switch Line */}
      <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 font-medium flex-wrap gap-2 pt-0.5">
        <div className="flex items-center gap-1.5">
          <span>
            {isHindi ? "सामान मिले:" : "Items:"}{" "}
            <strong className="text-slate-900 font-bold">{totalFilteredCount}</strong>
          </span>
          {hasActiveFilters && (
            <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
              {isHindi ? "फ़िल्टर चालू" : "Filtered"}
            </span>
          )}
        </div>

        {/* Sort Switcher Controls */}
        {onChangeSortOption && (
          <div className="flex items-center gap-1.5 ml-auto">
            <ArrowDownUp className="w-3 h-3 text-slate-400" />
            <select
              value={sortOption}
              onChange={(e) => onChangeSortOption(e.target.value as SortOption)}
              className="text-[11px] font-bold text-slate-700 bg-white border border-slate-200/90 rounded-lg px-2 py-1 focus:outline-hidden focus:ring-1 focus:ring-slate-400"
            >
              <option value="size_desc">
                {isHindi ? "⚖️ साइज: बड़ा पहले (Heavy First)" : "⚖️ Size: Largest First"}
              </option>
              <option value="size_asc">
                {isHindi ? "⚖️ साइज: छोटा पहले (Light First)" : "⚖️ Size: Smallest First"}
              </option>
              <option value="price_asc">
                {isHindi ? "🏷️ रेट: कम से ज्यादा (Price Low-High)" : "🏷️ Price: Low to High"}
              </option>
              <option value="price_desc">
                {isHindi ? "🏷️ रेट: ज्यादा से कम (Price High-Low)" : "🏷️ Price: High to Low"}
              </option>
              <option value="brand_asc">
                {isHindi ? "🔤 ब्रांड: A से Z (Brand A-Z)" : "🔤 Brand: A to Z"}
              </option>
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
