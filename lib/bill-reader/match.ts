/**
 * Match a bill line to a showroom product.
 *
 *  1. Supplier memory: this supplier's exact description was matched before
 *     (supplier_item_aliases) → same product.
 *  2. Model number: the product's model number appears in the description
 *     ("REF -GLT2516WXDS D.DOOR LG" contains GL-T2516WXDS once dashes/spaces are ignored).
 *  3. Otherwise: suggestions ranked by brand / size / shared words, for the owner to pick
 *     — or a new product.
 */

export interface CatalogItem {
  id: string;
  modelNumber: string;
  variantName: string;
  brand: string;
  productName: string;
  categoryId: string | null;
  categoryName: string;
  currentStock: number;
}

export type MatchType = "memory_alias" | "model_number" | "fuzzy_specs" | "manual" | "new_product";

/** Same rule the database uses for supplier_item_aliases.clean_description. */
export function cleanDescription(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Letters and digits only, upper case: "GL-T2516WXDS" → "GLT2516WXDS". */
export function compactModel(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** A product whose model number (5+ characters) appears in the description. Longest wins. */
export function matchByModel(description: string, catalog: CatalogItem[]): CatalogItem | null {
  const d = compactModel(description);
  let best: CatalogItem | null = null;
  for (const item of catalog) {
    const m = compactModel(item.modelNumber);
    if (m.length < 5 || !d.includes(m)) continue;
    if (!best || m.length > compactModel(best.modelNumber).length) best = item;
  }
  return best;
}

const words = (s: string) =>
  s
    .toUpperCase()
    .split(/[^A-Z0-9.]+/)
    .filter((w) => w.length >= 2);

/** Products ranked by how much they look like the description (for the owner to choose). */
export function suggestProducts(description: string, brand: string | null, catalog: CatalogItem[], limit = 5): CatalogItem[] {
  const dw = new Set(words(description));
  const dc = compactModel(description);
  const scored = catalog.map((item) => {
    let score = 0;
    if (brand && item.brand.toUpperCase() === brand.toUpperCase()) score += 3;
    else if (dw.has(item.brand.toUpperCase())) score += 3;
    for (const w of words(`${item.productName} ${item.variantName}`)) if (dw.has(w)) score += 1;
    // Part of the model number in the description ("T2516" of "GL-T2516WXDS").
    const m = compactModel(item.modelNumber);
    for (let len = Math.min(m.length, 8); len >= 4; len--) {
      if ([...Array(m.length - len + 1).keys()].some((i) => dc.includes(m.slice(i, i + len)))) {
        score += len - 2;
        break;
      }
    }
    return { item, score };
  });
  return scored
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

/** Model number to propose for a new product: the hint, or the longest letters+digits token. */
export function proposeModelNumber(description: string, hint: string | null): string {
  if (hint) return hint;
  const tokens = description.split(/[\s()]+/).filter((t) => /[A-Za-z]/.test(t) && /\d/.test(t) && t.length >= 5);
  return tokens.sort((a, b) => b.length - a.length)[0]?.replace(/[^A-Za-z0-9\-/.]/g, "") ?? "";
}
