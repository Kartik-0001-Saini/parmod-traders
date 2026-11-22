"use client";

import React from "react";
import { Store, Globe, KeyRound, Loader2 } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { LoginForm } from "@/components/LoginForm";

/**
 * Full-page login gate.
 * Shown to anyone who is not logged in. No inventory, search, or upload
 * is rendered (or fetched) until a staff or owner account signs in.
 */
export function LoginScreen() {
  const { lang, toggleLang, t } = useLanguage();
  const isHindi = lang === "hi";

  return (
    <div className="min-h-screen bg-slate-100/70 flex flex-col">
      {/* Top bar: brand + language switch */}
      <div className="px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white shadow-xs">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-slate-900 tracking-tight leading-none">
                {t.appName}
              </h1>
              <p className="text-xs text-slate-500 font-medium leading-tight mt-0.5">
                {t.appTagline}
              </p>
            </div>
          </div>

          <button
            onClick={toggleLang}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors active:scale-95 border border-slate-200"
            aria-label="Switch Language"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-semibold text-slate-800">
              {lang === "en" ? "हिन्दी" : "English"}
            </span>
          </button>
        </div>
      </div>

      {/* Login card */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-xl border border-slate-100 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
              <KeyRound className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 text-lg leading-tight">
                {isHindi ? "स्टाफ / मालिक लॉगिन" : "Staff / Owner Login"}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {isHindi
                  ? "स्टॉक देखने के लिए लॉगिन करें"
                  : "Log in to view the showroom inventory"}
              </p>
            </div>
          </div>

          <LoginForm />
        </div>
      </main>
    </div>
  );
}

/**
 * Shown for a moment while the saved login session is being checked,
 * so logged-in users don't see the login form flash on page load.
 */
export function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-100/70 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" aria-label="Loading" />
    </div>
  );
}
