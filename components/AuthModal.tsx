"use client";

import React, { useState } from "react";
import { UserCheck, LogOut, KeyRound, Mail, Lock, X, AlertCircle, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/language-context";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { lang } = useLanguage();
  const { user, role, fullName, signIn, signOut, isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

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
      onClose();
    } else {
      setErrorMsg(
        isHindi
          ? "ईमेल या पासवर्ड गलत है। कृपया दोबारा जाँचें।"
          : res.error || "Invalid email or password. Please try again."
      );
    }
  };

  const handleLogout = async () => {
    await signOut();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 animate-in zoom-in-95 duration-150 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Icon & Title */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
            {isAuthenticated ? (
              <UserCheck className="w-6 h-6 stroke-[2.2]" />
            ) : (
              <KeyRound className="w-6 h-6 stroke-[2.2]" />
            )}
          </div>
          <div>
            <h3 className="font-extrabold text-slate-900 text-lg leading-tight">
              {isAuthenticated
                ? isHindi
                  ? "लॉगिन खाता विवरण"
                  : "Account Details"
                : isHindi
                ? "स्टाफ / मालिक लॉगिन"
                : "Staff / Owner Login"}
            </h3>
            <p className="text-xs text-slate-500 font-medium">
              {isHindi ? "परमोद ट्रेडर्स सुरक्षा प्रणाली" : "Parmod Traders Secure Portal"}
            </p>
          </div>
        </div>

        {/* If Already Logged In: Show Profile & Sign Out */}
        {isAuthenticated ? (
          <div className="flex flex-col gap-3 py-2">
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                  {isHindi ? "भूमिका (Role)" : "Role"}
                </span>
                <span className={`text-[11px] font-black uppercase px-2 py-0.5 rounded-full ${
                  role === "owner"
                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                    : "bg-emerald-100 text-emerald-900 border border-emerald-300"
                }`}>
                  {role === "owner" ? (isHindi ? "मालिक (Owner)" : "Owner") : (isHindi ? "स्टाफ (Staff)" : "Staff")}
                </span>
              </div>
              <p className="font-bold text-slate-900 text-sm mt-1">
                {fullName || user?.email}
              </p>
              <p className="text-xs text-slate-500 font-mono">
                {user?.email}
              </p>
            </div>

            <p className="text-xs text-slate-500 leading-tight">
              {role === "owner"
                ? isHindi
                  ? "आप मालिक खाते में हैं: आप खरीद रेट, बिल और पूरा स्टॉक नियंत्रित कर सकते हैं।"
                  : "Logged in as Owner: You have full access to purchase prices, supplier bills, and catalog editing."
                : isHindi
                ? "आप स्टाफ खाते में हैं: आप सामान की बिक्री और वापसी दर्ज कर सकते हैं।"
                : "Logged in as Staff: You can record sales and customer returns on the showroom floor."}
            </p>

            <button
              onClick={handleLogout}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors active:scale-95"
            >
              <LogOut className="w-4 h-4" />
              <span>{isHindi ? "लॉग आउट करें" : "Sign Out"}</span>
            </button>
          </div>
        ) : (
          /* Login Form */
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
        )}
      </div>
    </div>
  );
}
