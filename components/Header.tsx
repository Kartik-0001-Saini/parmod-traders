"use client";

import React from "react";
import { ShieldCheck, KeyRound, Globe, Store } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

interface HeaderProps {
  mode: "check" | "update";
  onOpenPinModal: () => void;
  onSwitchToCheckMode: () => void;
}

export function Header({ mode, onOpenPinModal, onSwitchToCheckMode }: HeaderProps) {
  const { lang, toggleLang, t } = useLanguage();

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-3 shadow-xs">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
        {/* Logo and Brand Name */}
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-xs">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-lg text-slate-900 tracking-tight leading-none">
                {t.appName}
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Showroom
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-tight mt-0.5">
              {t.appTagline}
            </p>
          </div>
        </div>

        {/* Right Action Controls: Mode Badge + Language Toggle */}
        <div className="flex items-center gap-2">
          {/* Mode Badge Button */}
          {mode === "check" ? (
            <button
              onClick={onOpenPinModal}
              title={t.modeCheckSub}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors shadow-2xs active:scale-95"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="hidden sm:inline">{t.modeCheck}</span>
              <span className="sm:hidden">{lang === "hi" ? "देखें" : "Check"}</span>
            </button>
          ) : (
            <button
              onClick={onSwitchToCheckMode}
              title={t.modeUpdateSub}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors shadow-2xs active:scale-95 animate-pulse"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{t.modeUpdate}</span>
              <span className="sm:hidden">{lang === "hi" ? "बदलाव" : "Edit"}</span>
            </button>
          )}

          {/* Language Switcher */}
          <button
            onClick={toggleLang}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors active:scale-95 border border-slate-200"
            aria-label="Switch Language"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-800">
              {lang === "en" ? "हिन्दी" : "English"}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
