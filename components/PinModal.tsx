"use client";

import React, { useState } from "react";
import { X, KeyRound, Check } from "lucide-react";
import { useLanguage } from "@/lib/language-context";

interface PinModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export function PinModal({ isOpen, onSuccess, onClose }: PinModalProps) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  if (!isOpen) return null;

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setError(false);
      if (nextPin.length === 4) {
        verifyPin(nextPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
    setError(false);
  };

  const verifyPin = (enteredPin: string) => {
    // Default Owner Demo PIN is 1234
    if (enteredPin === "1234") {
      setPin("");
      setError(false);
      onSuccess();
    } else {
      setError(true);
      setTimeout(() => {
        setPin("");
      }, 800);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-xs bg-white rounded-3xl p-6 shadow-2xl border border-slate-100 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-150 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon */}
        <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mt-2">
          <KeyRound className="w-6 h-6 stroke-[2.2]" />
        </div>

        {/* Title */}
        <div className="text-center">
          <h3 className="font-extrabold text-slate-900 text-lg">
            {t.enterPin}
          </h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            {t.modeUpdateSub}
          </p>
        </div>

        {/* PIN Dots Display */}
        <div className="flex items-center gap-3 my-1">
          {[0, 1, 2, 3].map((index) => {
            const isFilled = pin.length > index;
            return (
              <div
                key={index}
                className={`w-4 h-4 rounded-full transition-all duration-150 ${
                  error
                    ? "bg-red-500 scale-110 animate-bounce"
                    : isFilled
                    ? "bg-slate-900 scale-110"
                    : "bg-slate-200"
                }`}
              />
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <p className="text-xs font-bold text-red-600 animate-pulse text-center">
            {t.wrongPin}
          </p>
        )}

        {/* Virtual Number Pad for phone screen ease */}
        <div className="grid grid-cols-3 gap-2 w-full pt-1">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"].map((key) => {
            if (key === "C") {
              return (
                <button
                  key={key}
                  onClick={handleBackspace}
                  className="py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 text-slate-600 active:scale-95 transition-all"
                >
                  Clear
                </button>
              );
            }
            if (key === "OK") {
              return (
                <button
                  key={key}
                  onClick={() => verifyPin(pin)}
                  className="py-3 rounded-xl font-bold text-sm bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 transition-all flex items-center justify-center"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                </button>
              );
            }
            return (
              <button
                key={key}
                onClick={() => handleDigit(key)}
                className="py-3 rounded-xl font-bold text-lg bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200/60 active:scale-95 transition-all shadow-2xs"
              >
                {key}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
