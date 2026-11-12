import { ProductItem } from "@/lib/mock-data";

/**
 * BEGINNER LESSON: Smart Normalized Search Engine
 * When showroom staff type on a mobile phone with one hand, they make typos:
 * "godrej 8kg", "godrej 8 kg", "samsng 55", "voltas 1.5 ton".
 * This engine normalizes units, splits into search tokens, and uses fuzzy distance
 * so the brother gets results in 0 milliseconds as he types.
 */

// Helper to calculate Levenshtein distance between two short words
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalizes text by removing punctuation, lowercasing,
 * and normalizing common appliance units (e.g. "8 kg" -> "8kg", "1.5 ton" -> "1.5ton").
 */
export function normalizeText(text: string): string {
  if (!text) return "";

  return text
    .toLowerCase()
    // Normalize units like 8 kg -> 8kg, 1.5 ton -> 1.5ton, 5 star -> 5star
    .replace(/(\d+(?:\.\d+)?)\s*(kg|k\.g\.|kilo|litres?|l|tons?|t|inch(?:es)?|"|stars?|watts?|w)/gi, "$1$2")
    // Replace punctuation with spaces
    .replace(/[-_./,"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a search token matches any word in the target string.
 * Supports exact match, prefix match, and 1-edit typo tolerance for words >= 4 letters.
 */
function tokenMatchesTarget(token: string, targetWords: string[], rawTarget: string): boolean {
  // 1. Direct substring match on whole string
  if (rawTarget.includes(token)) {
    return true;
  }

  // 2. Check against individual words
  for (const word of targetWords) {
    if (word === token || word.startsWith(token) || token.startsWith(word)) {
      return true;
    }

    // 3. Typo tolerance: if token is 4+ chars, allow 1 edit typo (e.g. samsng -> samsung)
    if (token.length >= 4 && word.length >= 4) {
      if (Math.abs(token.length - word.length) <= 1) {
        if (levenshteinDistance(token, word) <= 1) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Searches a list of products with high tolerance for typos, extra spaces, and unit variations.
 */
export function searchProducts(
  products: ProductItem[],
  query: string
): ProductItem[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return products;
  }

  // Split query into tokens: e.g. "godrej 8kg front" -> ["godrej", "8kg", "front"]
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return products.filter((product) => {
    // Build a rich, searchable representation of the product
    const specsString = Object.entries(product.specifications || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(" ");

    const rawTarget = normalizeText(
      `${product.brand} ${product.name} ${product.modelNumber} ${product.hsnCode || ""} ${product.variant} ${specsString}`
    );

    const targetWords = rawTarget.split(/\s+/);

    // Also create stripped strings without spaces or dashes for exact barcode/code matching
    const strippedModel = (product.modelNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const strippedHsn = (product.hsnCode || "").replace(/[^0-9]/g, "");

    // EVERY query token must match something in the product
    return queryTokens.every((token) => {
      const strippedToken = token.replace(/[^a-z0-9]/g, "");

      // If token matches stripped model number or HSN code
      if (strippedModel && strippedModel.includes(strippedToken)) {
        return true;
      }
      if (strippedHsn && strippedHsn.includes(strippedToken)) {
        return true;
      }

      return tokenMatchesTarget(token, targetWords, rawTarget);
    });
  });
}
