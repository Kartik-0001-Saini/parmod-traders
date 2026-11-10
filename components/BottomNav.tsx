"use client";

import React from "react";
import { Home, Package, ReceiptText, History } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

export type NavTab = "home" | "catalog" | "bills" | "history";

interface BottomNavProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export function BottomNav({ activeTab, onSelectTab }: BottomNavProps) {
  const { t } = useLanguage();

  const navItems = [
    { id: "home" as NavTab, label: t.navHome, icon: Home },
    { id: "catalog" as NavTab, label: t.navCatalog, icon: Package },
    { id: "bills" as NavTab, label: t.actionBillTitle, icon: ReceiptText },
    { id: "history" as NavTab, label: t.navHistory, icon: History },
  ];

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 shadow-lg">
      <div className="grid grid-cols-4 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all duration-150 active:scale-95 ${
                isActive
                  ? "text-emerald-700 font-bold bg-emerald-50/80"
                  : "text-slate-500 hover:text-slate-800 font-medium"
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
              <span className="text-[11px] mt-0.5 tracking-tight truncate max-w-full">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
