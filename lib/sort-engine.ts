import { ProductItem } from "@/lib/mock-data";

/**
 * BEGINNER LESSON: Multi-Tier Showroom Sorting Engine
 * Showroom business rule:
 * 1. Products are organized into HSN tax code groups.
 * 2. Inside each HSN group, products sort by:
 *    Tier 1: Weight / Capacity / Main Dimension (default: heaviest/biggest first)
 *    Tier 2: Feature / Type hierarchy (Front Load > Top Load > Semi-Auto; Inverter > Direct Cool)
 *    Tier 3: Selling Price (lowest first tie-breaker)
 */

export type SortOption =
  | "size_desc" // Heaviest / Largest first (Default)
  | "size_asc"  // Lightest / Smallest first
  | "price_asc" // Lowest price first
  | "price_desc" // Highest price first
  | "brand_asc"; // Brand A to Z

/**
 * Extracts the primary numerical size/capacity from a product across any showroom category.
 */
export function parsePrimaryNumericSize(item: ProductItem): number {
  const specs = item.specifications || {};

  // Helper regex to extract first float from text (e.g. "8.5 KG" -> 8.5)
  const extractNum = (str?: string): number | null => {
    if (!str) return null;
    const match = str.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  };

  // 1. Check category-specific specification keys
  const cat = (item.category || "").toLowerCase();

  if (cat === "washing-machines") {
    const val = extractNum(specs["Capacity"]) || extractNum(specs["capacity"]);
    if (val !== null) return val;
  } else if (cat === "refrigerators") {
    const val = extractNum(specs["Capacity"]) || extractNum(specs["capacity"]) || extractNum(specs["Volume"]);
    if (val !== null) return val;
  } else if (cat === "led-tvs") {
    const val =
      extractNum(specs["Screen Size"]) ||
      extractNum(specs["Screen"]) ||
      extractNum(specs["Size"]) ||
      extractNum(specs["screen_size"]);
    if (val !== null) return val;
  } else if (cat === "air-conditioners") {
    const val = extractNum(specs["Tonnage"]) || extractNum(specs["tonnage"]) || extractNum(specs["Capacity"]);
    if (val !== null) return val;
  } else if (cat === "air-coolers") {
    const val = extractNum(specs["Tank"]) || extractNum(specs["Capacity"]) || extractNum(specs["tank_capacity"]);
    if (val !== null) return val;
  }

  // 2. Scan all attribute values for any capacity/size unit
  for (const [k, v] of Object.entries(specs)) {
    if (/capacity|size|ton|kg|litre|inch|watt/i.test(k) || /kg|ton|litre|l|inch|"|w/i.test(v)) {
      const val = extractNum(v);
      if (val !== null) return val;
    }
  }

  // 3. Fallback: scan variant name or product name (e.g. "8 KG Front Load", "55 Inch UHD", "1.5 Ton")
  const nameScan = extractNum(`${item.variant} ${item.name}`);
  if (nameScan !== null) return nameScan;

  return 0;
}

/**
 * Returns a numerical rank for premium features within a category.
 * Lower number = higher premium rank (appears first).
 */
export function getFeatureRank(item: ProductItem): number {
  const specs = item.specifications || {};
  const fullText = `${item.variant} ${item.name} ${Object.values(specs).join(" ")}`.toLowerCase();

  // Washing Machines feature hierarchy
  if (/front\s*load/i.test(fullText)) return 1;
  if (/top\s*load/i.test(fullText)) return 2;
  if (/semi/i.test(fullText)) return 3;

  // Refrigerator feature hierarchy
  if (/side\s*by\s*side|french\s*door/i.test(fullText)) return 1;
  if (/double\s*door|frost\s*free/i.test(fullText)) return 2;
  if (/single\s*door|direct\s*cool/i.test(fullText)) return 3;

  // AC feature hierarchy
  if (/inverter/i.test(fullText)) return 1;
  if (/fixed|split/i.test(fullText)) return 2;

  // Energy Star hierarchy
  if (/5\s*star/i.test(fullText)) return 1;
  if (/4\s*star/i.test(fullText)) return 2;
  if (/3\s*star/i.test(fullText)) return 3;

  return 99; // Default rank
}

export interface HsnGroup {
  hsnCode: string;
  items: ProductItem[];
}

/**
 * Groups products by HSN tax code and sorts inside each HSN group
 * according to the 3-tier showroom rules.
 */
export function groupAndSortProducts(
  products: ProductItem[],
  sortOption: SortOption = "size_desc"
): HsnGroup[] {
  // 1. Group items by HSN code
  const groupsMap = new Map<string, ProductItem[]>();

  for (const item of products) {
    const hsn = item.hsnCode || "8450";
    if (!groupsMap.has(hsn)) {
      groupsMap.set(hsn, []);
    }
    groupsMap.get(hsn)!.push(item);
  }

  // 2. Sort inside each HSN group
  const result: HsnGroup[] = [];

  // Sort HSN groups numerically
  const sortedHsnKeys = Array.from(groupsMap.keys()).sort();

  for (const hsn of sortedHsnKeys) {
    const items = groupsMap.get(hsn)!;

    items.sort((a, b) => {
      if (sortOption === "size_desc") {
        // Tier 1: Heaviest / Biggest first
        const sizeDiff = parsePrimaryNumericSize(b) - parsePrimaryNumericSize(a);
        if (sizeDiff !== 0) return sizeDiff;

        // Tier 2: Feature hierarchy (Front Load > Top Load > Semi-Auto)
        const featDiff = getFeatureRank(a) - getFeatureRank(b);
        if (featDiff !== 0) return featDiff;

        // Tier 3: Lowest Selling Price first
        return a.sellingPrice - b.sellingPrice;
      }

      if (sortOption === "size_asc") {
        // Smallest / Lightest first
        const sizeDiff = parsePrimaryNumericSize(a) - parsePrimaryNumericSize(b);
        if (sizeDiff !== 0) return sizeDiff;

        const featDiff = getFeatureRank(a) - getFeatureRank(b);
        if (featDiff !== 0) return featDiff;

        return a.sellingPrice - b.sellingPrice;
      }

      if (sortOption === "price_asc") {
        // Lowest price first
        const priceDiff = a.sellingPrice - b.sellingPrice;
        if (priceDiff !== 0) return priceDiff;
        return parsePrimaryNumericSize(b) - parsePrimaryNumericSize(a);
      }

      if (sortOption === "price_desc") {
        // Highest price first
        const priceDiff = b.sellingPrice - a.sellingPrice;
        if (priceDiff !== 0) return priceDiff;
        return parsePrimaryNumericSize(b) - parsePrimaryNumericSize(a);
      }

      if (sortOption === "brand_asc") {
        // Brand alphabetical
        const brandDiff = a.brand.localeCompare(b.brand);
        if (brandDiff !== 0) return brandDiff;
        return a.sellingPrice - b.sellingPrice;
      }

      return 0;
    });

    result.push({
      hsnCode: hsn,
      items,
    });
  }

  return result;
}
