"use client";

import React, { useState } from "react";
import { Mail, Lock, AlertCircle, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/language-context";

interface LoginFormProps {
  onSuccess?: () => void;
}

/**
 * Email + password sign-in form.
 * Used by the full-page LoginScreen and by the AuthModal.
 */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const { lang } = useLanguage();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isHindi = lang === "hi";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const res = await signIn(email, password);
    setIsSubmitting(false);

    if (res.success) {
      setEmail("");
      setPassword("");
      onSuccess?.();
    } else {
      setErrorMsg(
        isHindi
          ? "ईमेल या पासवर्ड गलत है। कृपया दोबारा जाँचें।"
          : res.error || "Invalid email or password. Please try again."
      );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-1">
      {errorMsg && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold animate-shake">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div>
        <label className="text-xs font-bold text-slate-700 block mb-1">
          {isHindi ? "ईमेल पता" : "Email Address"}
        </label>
        <div className="relative">
          <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. staff@parmodtraders.com"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-bold text-slate-700 block mb-1">
          {isHindi ? "पासवर्ड" : "Password"}
        </label>
        <div className="relative">
          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
          />
        </div>
      </div>

      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <span>
          {isHindi
            ? "लॉगिन करने के बाद फोन पर खाता हमेशा एक्टिव रहेगा।"
            : "Your session stays permanently active on this device."}
        </span>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-1 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95 shadow-md shadow-emerald-600/20 disabled:opacity-50"
      >
        <span>{isSubmitting ? (isHindi ? "जाँच रहे हैं..." : "Signing In...") : (isHindi ? "लॉगिन करें" : "Sign In")}</span>
      </button>
    </form>
  );
}
