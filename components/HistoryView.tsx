"use client";

import React, { useState, useMemo } from "react";
import {
  History as HistoryIcon,
  Search,
  Calendar,
  RotateCcw,
  ShoppingCart,
  Boxes,
  RotateCw,
  Wrench,
  CheckCircle2,
  Filter,
  User,
  ArrowRight,
} from "lucide-react";
import { InventoryMovementRecord } from "@/lib/mock-data";
import { useLanguage } from "@/lib/language-context";
import { formatIndianDateTime } from "@/lib/utils";

interface HistoryViewProps {
  movements: InventoryMovementRecord[];
  onRefresh?: () => void;
}

type TimeFilter = "all" | "today" | "week";

export function HistoryView({ movements, onRefresh }: HistoryViewProps) {
  const { lang } = useLanguage();
  const isHindi = lang === "hi";

  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [productQuery, setProductQuery] = useState("");

  // Filtered movements calculation
  const filteredMovements = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

    return movements.filter((m) => {
      const movementTime = new Date(m.timestamp).getTime();

      // Time Filter
      if (timeFilter === "today" && movementTime < todayStart) {
        return false;
      }
      if (timeFilter === "week" && movementTime < weekStart) {
        return false;
      }

      // Product / Model Query Filter
      if (productQuery.trim()) {
        const q = productQuery.toLowerCase();
        const matchName = m.productName.toLowerCase().includes(q);
        const matchModel = m.modelNumber.toLowerCase().includes(q);
        const matchPerformer = m.performedBy.toLowerCase().includes(q);
        if (!matchName && !matchModel && !matchPerformer) {
          return false;
        }
      }

      return true;
    });
  }, [movements, timeFilter, productQuery]);

  // Today's summary counters
  const todayStats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayMovements = movements.filter(
      (m) => new Date(m.timestamp).getTime() >= todayStart && !m.isUndone
    );

    let salesCount = 0;
    let returnsCount = 0;

    for (const m of todayMovements) {
      if (m.type === "sale") salesCount += Math.abs(m.quantityChange);
      if (m.type === "return") returnsCount += m.quantityChange;
    }

    return { salesCount, returnsCount, totalActions: todayMovements.length };
  }, [movements]);

  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-200/90 shadow-xs flex flex-col gap-4">
      {/* 1. Header with Title & Refresh */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <HistoryIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-extrabold text-slate-900 text-base leading-tight">
              {isHindi ? "स्टॉक लेन-देन का इतिहास" : "Stock Movement Audit History"}
            </h2>
            <p className="text-[11px] text-slate-500 font-medium">
              {isHindi
                ? "दुकान में हुए सभी सौदों और बदलावों का पूरा रिकॉर्ड"
                : "Real-time transparent audit log for sales, returns, and inward deliveries"}
            </p>
          </div>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all active:scale-95"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{isHindi ? "ताज़ा करें" : "Refresh"}</span>
          </button>
        )}
      </div>

      {/* 2. Today's Quick Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div className="p-3 rounded-2xl bg-emerald-50/80 border border-emerald-200 text-emerald-950 flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            {isHindi ? "आज की बिक्री" : "Today's Sales"}
          </span>
          <span className="text-xl font-black text-emerald-900 mt-0.5">
            {todayStats.salesCount} {isHindi ? "पीस" : "units"}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-blue-50/80 border border-blue-200 text-blue-950 flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
            {isHindi ? "आज की वापसी" : "Today's Returns"}
          </span>
          <span className="text-xl font-black text-blue-900 mt-0.5">
            {todayStats.returnsCount} {isHindi ? "पीस" : "units"}
          </span>
        </div>

        <div className="col-span-2 sm:col-span-1 p-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            {isHindi ? "कुल रिकॉर्ड्स" : "Total Log Entries"}
          </span>
          <span className="text-xl font-black text-slate-800 mt-0.5">
            {movements.length}
          </span>
        </div>
      </div>

      {/* 3. Search & Time Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
        {/* Time Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          <button
            onClick={() => setTimeFilter("all")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
              timeFilter === "all"
                ? "bg-slate-900 text-white shadow-2xs"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700"
            }`}
          >
            {isHindi ? "सभी समय" : "All Time"}
          </button>

          <button
            onClick={() => setTimeFilter("today")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
              timeFilter === "today"
                ? "bg-emerald-600 text-white shadow-2xs"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700"
            }`}
          >
            {isHindi ? "आज (Today)" : "Today"}
          </button>

          <button
            onClick={() => setTimeFilter("week")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 ${
              timeFilter === "week"
                ? "bg-blue-600 text-white shadow-2xs"
                : "bg-slate-100 hover:bg-slate-200 text-slate-700"
            }`}
          >
            {isHindi ? "पिछले 7 दिन" : "Last 7 Days"}
          </button>
        </div>

        {/* Product / Model Search Input */}
        <div className="relative w-full sm:w-64">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder={isHindi ? "सामान या मॉडल खोजें..." : "Filter by model or item..."}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
          />
          {productQuery && (
            <button
              onClick={() => setProductQuery("")}
              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 4. Movements List */}
      <div className="flex flex-col divide-y divide-slate-100 mt-1">
        {filteredMovements.length === 0 ? (
          <div className="py-12 text-center flex flex-col items-center gap-2">
            <Filter className="w-8 h-8 text-slate-300" />
            <p className="text-xs font-bold text-slate-600">
              {isHindi ? "इस फ़िल्टर में कोई रिकॉर्ड नहीं मिला" : "No movement records match your filter"}
            </p>
            {(timeFilter !== "all" || productQuery) && (
              <button
                onClick={() => {
                  setTimeFilter("all");
                  setProductQuery("");
                }}
                className="text-[11px] font-bold text-emerald-700 underline mt-1"
              >
                {isHindi ? "फ़िल्टर रीसेट करें" : "Reset Filters"}
              </button>
            )}
          </div>
        ) : (
          filteredMovements.map((mov) => {
            const isNegative = mov.quantityChange < 0;
            const isUndone = mov.isUndone;

            // Type configuration
            let badgeStyle = "bg-emerald-50 text-emerald-800 border-emerald-200";
            let icon = <ShoppingCart className="w-3 h-3" />;
            let typeLabelEn = "Sold";
            let typeLabelHi = "बिका";

            if (mov.type === "return") {
              badgeStyle = "bg-blue-50 text-blue-800 border-blue-200";
              icon = <RotateCcw className="w-3 h-3" />;
              typeLabelEn = "Return";
              typeLabelHi = "वापसी";
            } else if (mov.type === "undo") {
              badgeStyle = "bg-purple-50 text-purple-800 border-purple-200";
              icon = <RotateCw className="w-3 h-3" />;
              typeLabelEn = "Undo";
              typeLabelHi = "अनडू (रद्द)";
            } else if (mov.type === "add_stock") {
              badgeStyle = "bg-teal-50 text-teal-800 border-teal-200";
              icon = <Boxes className="w-3 h-3" />;
              typeLabelEn = "Added Stock";
              typeLabelHi = "नया माल";
            } else if (mov.type === "correction") {
              badgeStyle = "bg-amber-50 text-amber-800 border-amber-200";
              icon = <Wrench className="w-3 h-3" />;
              typeLabelEn = "Correction";
              typeLabelHi = "सुधार";
            }

            return (
              <div
                key={mov.id}
                className={`py-3 flex items-start justify-between gap-3 transition-colors ${
                  isUndone ? "opacity-60 bg-slate-50/50" : "hover:bg-slate-50/40"
                }`}
              >
                {/* Left: Product & Performer Info */}
                <div className="flex items-start gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border mt-0.5 ${badgeStyle}`}
                  >
                    {icon}
                  </div>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4
                        className={`font-bold text-slate-900 text-xs ${
                          isUndone ? "line-through text-slate-500" : ""
                        }`}
                      >
                        {mov.productName}
                      </h4>

                      {/* Model Number Pill */}
                      <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        {mov.modelNumber}
                      </span>

                      {/* Undone Indicator Badge */}
                      {isUndone && (
                        <span className="text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded">
                          {isHindi ? "रद्द किया गया" : "Undone"}
                        </span>
                      )}
                    </div>

                    {/* Variant & Reason Note */}
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {mov.variant && <span>{mov.variant} • </span>}
                      <span className="font-medium text-slate-600">{mov.reason}</span>
                    </p>

                    {/* Performer & Indian Timestamp */}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1 font-semibold text-slate-600">
                        <User className="w-2.5 h-2.5" />
                        {mov.performedBy}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1 font-medium">
                        <Calendar className="w-2.5 h-2.5" />
                        {formatIndianDateTime(mov.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: Quantity Change & Transition */}
                <div className="text-right shrink-0">
                  <div
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-xs font-black ${
                      isUndone
                        ? "bg-slate-100 text-slate-400 border-slate-200 line-through"
                        : isNegative
                        ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                        : "bg-blue-100 text-blue-800 border-blue-200"
                    }`}
                  >
                    <span>{mov.quantityChange > 0 ? `+${mov.quantityChange}` : mov.quantityChange}</span>
                    <span className="text-[10px] font-bold">
                      ({isHindi ? typeLabelHi : typeLabelEn})
                    </span>
                  </div>

                  {/* Previous Stock -> New Stock Indicator */}
                  <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 mt-1 font-mono font-semibold">
                    <span>{mov.previousStock}</span>
                    <ArrowRight className="w-2.5 h-2.5 text-slate-300" />
                    <span className="font-bold text-slate-700">{mov.newStock}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
