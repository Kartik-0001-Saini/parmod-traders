"use client";

import React from "react";
import { ShoppingBag, PlusCircle, ScanLine, Search } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

interface ActionTilesProps {
  onSoldClick: () => void;
  onAddStockClick: () => void;
  onUploadBillClick: () => void;
  onSearchClick: () => void;
}

export function ActionTiles({
  onSoldClick,
  onAddStockClick,
  onUploadBillClick,
  onSearchClick,
}: ActionTilesProps) {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* 1. Sold an Item */}
      <button
        onClick={onSoldClick}
        className="group relative flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm hover:shadow-md transition-all duration-200 active:scale-97 text-left overflow-hidden border border-emerald-400/30"
      >
        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white mb-2 group-hover:scale-110 transition-transform">
          <ShoppingBag className="w-5 h-5 stroke-[2.2]" />
        </div>
        <div>
          <h3 className="font-bold text-sm tracking-tight leading-snug">
            {t.actionSoldTitle}
          </h3>
          <p className="text-[11px] text-emerald-100/90 leading-tight mt-0.5 line-clamp-1">
            {t.actionSoldDesc}
          </p>
        </div>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px] font-bold uppercase tracking-wider">
          Quick -1
        </div>
      </button>

      {/* 2. Add Stock */}
      <button
        onClick={onAddStockClick}
        className="group relative flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-sm hover:shadow-md transition-all duration-200 active:scale-97 text-left overflow-hidden border border-blue-400/30"
      >
        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white mb-2 group-hover:scale-110 transition-transform">
          <PlusCircle className="w-5 h-5 stroke-[2.2]" />
        </div>
        <div>
          <h3 className="font-bold text-sm tracking-tight leading-snug">
            {t.actionAddStockTitle}
          </h3>
          <p className="text-[11px] text-blue-100/90 leading-tight mt-0.5 line-clamp-1">
            {t.actionAddStockDesc}
          </p>
        </div>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px] font-bold uppercase tracking-wider">
          Stock +1
        </div>
      </button>

      {/* 3. Upload Bill */}
      <button
        onClick={onUploadBillClick}
        className="group relative flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm hover:shadow-md transition-all duration-200 active:scale-97 text-left overflow-hidden border border-indigo-400/30"
      >
        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white mb-2 group-hover:scale-110 transition-transform">
          <ScanLine className="w-5 h-5 stroke-[2.2]" />
        </div>
        <div>
          <h3 className="font-bold text-sm tracking-tight leading-snug">
            {t.actionBillTitle}
          </h3>
          <p className="text-[11px] text-indigo-100/90 leading-tight mt-0.5 line-clamp-1">
            {t.actionBillDesc}
          </p>
        </div>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[9px] font-extrabold uppercase tracking-wider">
          AI
        </div>
      </button>

      {/* 4. Search Products */}
      <button
        onClick={onSearchClick}
        className="group relative flex flex-col items-start justify-between p-3.5 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm hover:shadow-md transition-all duration-200 active:scale-97 text-left overflow-hidden border border-amber-400/30"
      >
        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white mb-2 group-hover:scale-110 transition-transform">
          <Search className="w-5 h-5 stroke-[2.2]" />
        </div>
        <div>
          <h3 className="font-bold text-sm tracking-tight leading-snug">
            {t.actionSearchTitle}
          </h3>
          <p className="text-[11px] text-amber-100/90 leading-tight mt-0.5 line-clamp-1">
            {t.actionSearchDesc}
          </p>
        </div>
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-white/20 text-[9px] font-bold uppercase tracking-wider">
          Find
        </div>
      </button>
    </div>
  );
}
