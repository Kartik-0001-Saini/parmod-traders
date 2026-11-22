/**
 * Guesses from a bill line's description that help match it to a showroom
 * product (or pre-fill a new one): brand, category, size, model number.
 * These are hints for the review screen, never final.
 */
import { ProductHints } from "./types";

/** Brand list (from parse_bill.py, plus common appliance brands). Display name → spellings. */
const BRANDS: Record<string, string[]> = {
  Godrej: ["GODREJ"], Samsung: ["SAMSUNG"], Voltas: ["VOLTAS"], LG: ["LG"], Haier: ["HAIER", "HAIRE"],
  Lloyd: ["LLOYD"], Whirlpool: ["WHIRLPOOL"], IFB: ["IFB"], Bosch: ["BOSCH"], Sony: ["SONY"],
  Panasonic: ["PANASONIC"], Daikin: ["DAIKIN"], Hitachi: ["HITACHI"], Carrier: ["CARRIER"],
  "Blue Star": ["BLUE STAR", "BLUESTAR"], Symphony: ["SYMPHONY"], Crompton: ["CROMPTON"], Bajaj: ["BAJAJ"],
  Usha: ["USHA"], Orient: ["ORIENT"], Kenstar: ["KENSTAR"], Onida: ["ONIDA"], TCL: ["TCL"], Mi: ["MI"],
  Redmi: ["REDMI"], Xiaomi: ["XIAOMI"], Vu: ["VU"], Hisense: ["HISENSE"], Mitsubishi: ["MITSUBISHI"],
  "O General": ["O GENERAL", "OGENERAL"], Sharp: ["SHARP"], Toshiba: ["TOSHIBA"], Videocon: ["VIDEOCON"],
  Intex: ["INTEX"], Kelvinator: ["KELVINATOR"], MarQ: ["MARQ"], Acer: ["ACER"], Thomson: ["THOMSON"],
  Kodak: ["KODAK"], Cello: ["CELLO"], Sansui: ["SANSUI"], Kent: ["KENT"], Havells: ["HAVELLS"],
  Philips: ["PHILIPS"], Prestige: ["PRESTIGE"], Pigeon: ["PIGEON"], "V-Guard": ["V-GUARD", "VGUARD"],
  "Morphy Richards": ["MORPHY RICHARDS"], boAt: ["BOAT"], Atomberg: ["ATOMBERG"], Polycab: ["POLYCAB"],
};

/** Keyword → category name exactly as in the showroom's categories table. */
const CATEGORY_RULES: [RegExp, string][] = [
  // Accessories first, so "AC Stabilizer" isn't filed as an AC.
  [/stabili[sz]er|microwave|\boven\b|\botg\b|air\s*fryer|purifier|geyser|heater|\bfan\b|\biron\b|mixer|grinder|speaker|soundbar|home\s*theat/i, "Other Electronics"],
  [/\b(split|window|inverter)?\s*a\.?c\b|air\s*condition|\b\d+(\.\d+)?\s*ton\b/i, "Air Conditioners"],
  [/refrigerator|fridge|\bref\b|double\s*door|single\s*door|side\s*by\s*side/i, "Refrigerators"],
  [/washing|\bwm\b|top\s*load|front\s*load|fully\s*auto|semi\s*auto/i, "Washing Machines"],
  [/\b(led|smart|android|qled|oled|uhd|4k)?\s*tv\b|television|\b\d{2}\s*(inch|in|")/i, "LED TVs"],
  [/cooler/i, "Air Coolers"],
];

const SIZE_UNITS: [RegExp, string][] = [
  [/^(ton|tons|tr)$/i, "Ton"],
  [/^(l|ltr|ltrs|litre|liter|litres|liters)$/i, "L"],
  [/^(kg|kgs)$/i, "Kg"],
  [/^(inch|inches|in|")$/i, "inch"],
  [/^kva$/i, "KVA"],
  [/^(w|watt|watts)$/i, "W"],
  [/^(sqmm)$/i, "sqmm"],
  [/^(hp)$/i, "HP"],
];

function findBrand(description: string): string | null {
  const upper = ` ${description.toUpperCase().replace(/[^A-Z0-9-]+/g, " ")} `;
  const squashed = upper.replace(/\s+/g, "");
  let best: { name: string; len: number } | null = null;
  for (const [name, spellings] of Object.entries(BRANDS)) {
    for (const s of spellings) {
      const whole = upper.includes(` ${s} `);
      // Glued spellings ("BLUESTAR", "GODREJ2026") — only for longer names, to avoid "MI" / "VU" noise.
      const glued = s.replace(/\s/g, "").length >= 5 && squashed.includes(s.replace(/\s/g, ""));
      if ((whole || glued) && (!best || s.length > best.len)) best = { name, len: s.length };
    }
  }
  return best?.name ?? null;
}

function findSize(description: string): string | null {
  const m = /(\d+(?:\.\d+)?)\s*(tons?|tr|ltrs?|litres?|liters?|l|kgs?|inch(?:es)?|in|"|kva|watts?|w|sqmm|hp)\b/i.exec(description)
    ?? /(\d+(?:\.\d+)?)\s*(")/.exec(description);
  if (!m) return null;
  const unit = SIZE_UNITS.find(([re]) => re.test(m[2]))?.[1] ?? m[2];
  return `${m[1]} ${unit}`;
}

function findModel(description: string): string | null {
  const tokens = description.split(/\s+/);
  for (const t of tokens) {
    const clean = t.replace(/[^A-Za-z0-9-/]/g, "");
    if (clean.length < 4) continue;
    const hasDigit = /\d/.test(clean);
    const hasLetter = /[A-Za-z]/.test(clean);
    const isSize = /^\d+(\.\d+)?(ton|tr|l|ltr|kg|kgs|inch|in|kva|w|sqmm|hp|mm|cm)$/i.test(clean);
    if (hasDigit && hasLetter && !isSize) return clean.toUpperCase();
  }
  return null;
}

export function productHints(description: string): ProductHints {
  const category = CATEGORY_RULES.find(([re]) => re.test(description))?.[1] ?? null;
  return {
    brand: findBrand(description),
    category,
    sizeSpec: findSize(description),
    modelCandidate: findModel(description),
  };
}
