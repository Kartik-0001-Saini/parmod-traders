import React from "react";

/**
 * BEGINNER LESSON: Skeleton Loading Screens
 * Instead of showing a blank screen or a boring spinner, skeleton cards mirror
 * the exact shape of real product cards with a pulsing animation.
 * This makes the app feel 3x faster to the user!
 */

export function ProductCardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 w-full">
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col justify-between shadow-xs animate-pulse overflow-hidden min-h-[290px]"
        >
          {/* Top Section: Brand & Model Number badges */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="h-4 w-16 bg-slate-200 rounded-md" />
              <div className="h-4 w-24 bg-slate-200 rounded-md" />
            </div>

            {/* Product Title Skeleton */}
            <div className="h-5 w-4/5 bg-slate-200 rounded-md mb-2" />
            <div className="h-4 w-3/5 bg-slate-100 rounded-md mb-3" />

            {/* Specs Pills */}
            <div className="flex gap-1.5 mb-4">
              <div className="h-4 w-14 bg-slate-100 rounded-sm" />
              <div className="h-4 w-16 bg-slate-100 rounded-sm" />
              <div className="h-4 w-12 bg-slate-100 rounded-sm" />
            </div>
          </div>

          {/* Middle Section: Stock Pill */}
          <div className="py-2.5 px-3 bg-slate-50 rounded-xl mb-3 flex items-center justify-between">
            <div className="h-5 w-24 bg-slate-200 rounded-full" />
            <div className="h-3 w-16 bg-slate-200 rounded-md" />
          </div>

          {/* Bottom Section: Price & Buttons */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <div className="h-6 w-24 bg-slate-200 rounded-md" />
              <div className="h-4 w-16 bg-slate-100 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="h-9 bg-slate-200 rounded-xl" />
              <div className="h-9 bg-slate-100 rounded-xl" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
