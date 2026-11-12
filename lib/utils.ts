import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines Tailwind classes cleanly and avoids class conflicts.
 * New concept for beginner: "clsx" lets you conditionally apply classes (e.g. isRed && 'bg-red-500'),
 * and "twMerge" makes sure that if you write 'p-2 p-4', 'p-4' wins without CSS bugs.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a number into Indian Rupee format (e.g. 24990 -> ₹24,990)
 */
export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Calculates days passed since a date string and gives a human-friendly string.
 */
export function getDaysAgo(dateString: string): { days: number; labelEn: string; labelHi: string } {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return { days: 0, labelEn: "Updated today", labelHi: "आज जाँचा गया" };
  } else if (days === 1) {
    return { days: 1, labelEn: "Updated yesterday", labelHi: "कल जाँचा गया" };
  } else {
    return {
      days,
      labelEn: `Updated ${days} days ago`,
      labelHi: `${days} दिन पहले जाँचा गया`,
    };
  }
}

/**
 * Formats an ISO date into standard Indian format (e.g. "12 Nov 2026, 02:45 PM")
 */
export function formatIndianDateTime(isoString: string): string {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return isoString;
  }
}
