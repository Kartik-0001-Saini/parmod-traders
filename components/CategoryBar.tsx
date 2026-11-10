"use client";

import React from "react";
import { useLanguage } from "@/lib/language-context";

export type CategoryFilter =
  | "all"
  | "washing-machines"
  | "refrigerators"
  | "air-conditioners"
  | "led-tvs"
  | "air-coolers"
  | "other";

interface CategoryBarProps {
  selectedCategory: CategoryFilter;
  onSelectCategory: (cat: CategoryFilter) => void;
}

export function CategoryBar({
  selectedCategory,
  onSelectCategory,
}: CategoryBarProps) {
  const { t } = useLanguage();

  const categories: { id: CategoryFilter; label: string; icon: string }[] = [
    { id: "all", label: t.allCategories, icon: "🏷️" },
    { id: "washing-machines", label: t.catWashingMachines, icon: "🧺" },
    { id: "refrigerators", label: t.catRefrigerators, icon: "❄️" },
    { id: "air-conditioners", label: t.catAirConditioners, icon: "💨" },
    { id: "led-tvs", label: t.catLedTvs, icon: "📺" },
    { id: "air-coolers", label: t.catAirCoolers, icon: "🌀" },
    { id: "other", label: t.catOther, icon: "🔌" },
  ];

  return (
    <div className="w-full overflow-x-auto no-scrollbar py-1">
      <div className="flex items-center gap-2 min-w-max px-0.5">
        {categories.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition-all duration-150 active:scale-95 shadow-2xs ${
                isSelected
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200/80"
              }`}
            >
              <span className="text-sm">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
