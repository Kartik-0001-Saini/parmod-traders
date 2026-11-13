import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ProductItem, InventoryMovementRecord } from "@/lib/mock-data";

/**
 * BEGINNER LESSON: Hardened Service Layer
 * In production, we NEVER show fake mock data as real inventory.
 * If the cloud database is disconnected or returns an error, we report the error honestly
 * so the showroom staff or owner knows immediately to check their connection.
 */

export interface DbCategory {
  id: string;
  name: string;
  nameHi: string;
  slug: string;
  icon: string;
}

export interface DynamicFilterOptions {
  brands: string[];
  categories: { slug: string; nameEn: string; nameHi: string; icon: string }[];
  specsByKey: Record<string, string[]>;
}

export async function fetchShowroomCategories(): Promise<{
  categories: DbCategory[];
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      categories: [],
      error: "Supabase credentials are not configured in .env.local",
    };
  }

  try {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, name_hi, slug, icon, display_order")
      .order("display_order", { ascending: true });

    if (error) {
      return { categories: [], error: error.message };
    }

    const categories = (data || []).map((c) => ({
      id: c.id,
      name: c.name,
      nameHi: c.name_hi,
      slug: c.slug,
      icon: c.icon,
    }));

    return { categories };
  } catch (err: any) {
    return { categories: [], error: err?.message || "Failed to fetch categories" };
  }
}

/**
 * Fetches all active showroom product variants from Supabase in ONE single optimized query.
 * NOTE: Sensitive purchase prices are NOT in this table!
 * They are stored in the private product_costs table.
 */
export async function fetchShowroomProducts(): Promise<{
  products: ProductItem[];
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return {
      products: [],
      error: "Supabase connection is not configured in .env.local",
    };
  }

  try {
    const { data, error } = await supabase
      .from("product_variants")
      .select(`
        id,
        variant_name,
        model_number,
        hsn_code,
        attributes,
        current_stock,
        low_stock_threshold,
        selling_price,
        mrp,
        last_verified_at,
        is_active,
        is_test_seed,
        products (
          id,
          brand,
          name,
          image_url,
          categories (
            id,
            name,
            name_hi,
            slug,
            icon
          )
        )
      `)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase fetch error:", error.message);
      return { products: [], error: error.message };
    }

    if (!data || data.length === 0) {
      return { products: [] };
    }

    // Transform Supabase rows into UI ProductItem format
    const transformed: ProductItem[] = data.map((item: any) => {
      const prod = item.products || {};
      const cat = prod.categories || {};

      return {
        id: item.id,
        name: prod.name || "Showroom Product",
        brand: prod.brand || "Brand",
        category: (cat.slug || "other") as any,
        categoryNameEn: cat.name || "Electronics",
        categoryNameHi: cat.name_hi || "इलेक्ट्रॉनिक्स",
        variant: item.variant_name,
        modelNumber: item.model_number,
        hsnCode: item.hsn_code || "8450",
        currentStock: item.current_stock,
        lowStockThreshold: item.low_stock_threshold || 2,
        sellingPrice: Number(item.selling_price),
        mrp: Number(item.mrp),
        lastVerifiedDate: item.last_verified_at || new Date().toISOString(),
        imageUrl: prod.image_url,
        specifications: item.attributes || {},
      };
    });

    return { products: transformed };
  } catch (err: any) {
    console.error("Exception in fetchShowroomProducts:", err);
    return { products: [], error: err?.message || "Failed to load products" };
  }
}

/**
 * Fetches all purchase prices from the private product_costs table as a Map.
 * SECURITY: If the caller is not logged in as Owner, PostgreSQL RLS returns 0 rows!
 * Result: Staff and public payloads receive an empty object {} (Zero-Knowledge).
 */
export async function fetchOwnerCostMap(): Promise<Record<string, number>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return {};

  try {
    const { data, error } = await supabase
      .from("product_costs")
      .select("variant_id, purchase_price");

    if (error || !data) {
      return {};
    }

    const costMap: Record<string, number> = {};
    for (const row of data) {
      costMap[row.variant_id] = Number(row.purchase_price);
    }
    return costMap;
  } catch {
    return {};
  }
}

/**
 * Dynamically extracts all distinct brands and specs from the currently loaded products.
 * No hardcoding! If a new brand or attribute is inserted in Supabase,
 * it immediately appears as an interactive filter chip.
 */
export function extractDynamicFilterOptions(
  products: ProductItem[],
  categoriesFromDb: DbCategory[] = []
): DynamicFilterOptions {
  const brandSet = new Set<string>();
  const categoryMap = new Map<string, { slug: string; nameEn: string; nameHi: string; icon: string }>();
  const specsMap: Record<string, Set<string>> = {};

  // First populate categories from DB
  for (const cat of categoriesFromDb) {
    categoryMap.set(cat.slug, {
      slug: cat.slug,
      nameEn: cat.name,
      nameHi: cat.nameHi,
      icon: cat.icon,
    });
  }

  for (const p of products) {
    if (p.brand) {
      brandSet.add(p.brand.trim());
    }

    if (p.category && !categoryMap.has(p.category)) {
      categoryMap.set(p.category, {
        slug: p.category,
        nameEn: p.categoryNameEn || p.category,
        nameHi: p.categoryNameHi || p.category,
        icon: "🏷️",
      });
    }

    // Extract specs (Capacity, Star Rating, Tonnage, Screen Size, Type, etc.)
    if (p.specifications && typeof p.specifications === "object") {
      for (const [key, val] of Object.entries(p.specifications)) {
        if (!val || typeof val !== "string") continue;
        const cleanKey = key.trim();
        const cleanVal = val.trim();
        if (!specsMap[cleanKey]) {
          specsMap[cleanKey] = new Set<string>();
        }
        specsMap[cleanKey].add(cleanVal);
      }
    }
  }

  // Convert Sets to sorted Arrays
  const specsByKey: Record<string, string[]> = {};
  for (const [k, vSet] of Object.entries(specsMap)) {
    specsByKey[k] = Array.from(vSet).sort();
  }

  return {
    brands: Array.from(brandSet).sort(),
    categories: Array.from(categoryMap.values()),
    specsByKey,
  };
}

/**
 * Executes a stock movement atomically on Supabase.
 * Requires logged-in Staff or Owner session.
 */
export async function executeStockChange(params: {
  variantId: string;
  changeQty: number; // -1 for sale, +1 for return
  reason: "sale" | "return" | "manual_correction" | "stock_count" | "undo";
  notes?: string;
  originalMovementId?: string;
}): Promise<{
  success: boolean;
  newStock?: number;
  previousStock?: number;
  movementId?: string;
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return { success: false, error: "Database connection not configured" };
  }

  // Ensure user is logged in
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    return {
      success: false,
      error: "You must be logged in as Staff or Owner to change stock.",
    };
  }

  try {
    const { data, error } = await supabase.rpc("execute_stock_movement", {
      p_variant_id: params.variantId,
      p_change_qty: params.changeQty,
      p_reason: params.reason,
      p_notes: params.notes || null,
      p_original_movement_id: params.originalMovementId || null,
    });

    if (error) {
      console.error("Supabase execute_stock_movement error:", error.message);
      return { success: false, error: error.message };
    }

    const res = data as any;
    return {
      success: true,
      newStock: res?.new_stock,
      previousStock: res?.previous_stock,
      movementId: res?.movement_id,
    };
  } catch (err: any) {
    console.error("Exception in executeStockChange:", err);
    return { success: false, error: err?.message || "Failed to update stock" };
  }
}

/**
 * Fetches recent stock movement audit history from Supabase.
 */
export async function fetchMovementHistory(): Promise<InventoryMovementRecord[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select(`
        id,
        variant_id,
        change_qty,
        previous_stock,
        new_stock,
        reason,
        notes,
        performed_by,
        created_at,
        is_undone,
        original_movement_id,
        product_variants (
          variant_name,
          model_number,
          products (
            name
          )
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error || !data) {
      return [];
    }

    return data.map((m: any) => {
      const variant = m.product_variants || {};
      const prod = variant.products || {};

      let type: "sale" | "return" | "add_stock" | "correction" | "undo" = "correction";
      if (m.reason === "sale") type = "sale";
      else if (m.reason === "return") type = "return";
      else if (m.reason === "undo") type = "undo";
      else if (m.reason === "stock_count") type = "add_stock";

      return {
        id: m.id,
        productId: m.variant_id,
        productName: prod.name || "Showroom Item",
        variant: variant.variant_name || "",
        modelNumber: variant.model_number || "",
        type,
        quantityChange: m.change_qty,
        previousStock: m.previous_stock,
        newStock: m.new_stock,
        reason: m.notes || m.reason,
        timestamp: m.created_at,
        performedBy: m.performed_by,
        isUndone: m.is_undone || false,
        originalMovementId: m.original_movement_id || undefined,
      };
    });
  } catch (err) {
    console.error("Exception fetching movement history:", err);
    return [];
  }
}

/**
 * Checks if a model number already exists in product_variants (case-insensitive).
 * Useful for live duplicate detection in the Add Product form.
 */
export async function checkModelNumberExists(modelNumber: string): Promise<{
  exists: boolean;
  variantName?: string;
  variantId?: string;
  error?: string;
}> {
  const clean = modelNumber.trim();
  if (!clean) return { exists: false };

  const supabase = getSupabaseBrowserClient();
  if (!supabase) return { exists: false };

  try {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id, variant_name, model_number")
      .ilike("model_number", clean)
      .limit(1);

    if (error) {
      return { exists: false, error: error.message };
    }

    if (data && data.length > 0) {
      return {
        exists: true,
        variantId: data[0].id,
        variantName: data[0].variant_name,
      };
    }

    return { exists: false };
  } catch (err: any) {
    return { exists: false, error: err?.message };
  }
}

export interface CreateProductParams {
  categoryId: string;
  brand: string;
  name: string;
  variantName: string;
  modelNumber: string;
  hsnCode: string;
  attributes?: Record<string, string>;
  mrp: number;
  sellingPrice: number;
  purchasePrice?: number | null;
  openingStock: number;
  lowStockThreshold?: number;
}

/**
 * Creates a new product variant and saves the purchase price directly
 * into the private product_costs table (Owner only RPC).
 */
export async function createProductWithVariant(
  params: CreateProductParams
): Promise<{
  success: boolean;
  variantId?: string;
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { success: false, error: "Database not connected" };
  }

  try {
    const { data, error } = await supabase.rpc("create_product_with_variant_and_cost", {
      p_category_id: params.categoryId,
      p_brand: params.brand.trim(),
      p_name: params.name.trim(),
      p_variant_name: params.variantName.trim(),
      p_model_number: params.modelNumber.trim(),
      p_hsn_code: params.hsnCode.trim(),
      p_attributes: params.attributes || {},
      p_mrp: params.mrp,
      p_selling_price: params.sellingPrice,
      p_purchase_price: params.purchasePrice ?? null,
      p_opening_stock: params.openingStock || 0,
      p_low_stock_threshold: params.lowStockThreshold || 2,
    });

    if (error) {
      console.error("RPC create_product_with_variant_and_cost error:", error.message);
      return { success: false, error: error.message };
    }

    const res = data as any;
    return {
      success: true,
      variantId: res?.variant_id,
    };
  } catch (err: any) {
    console.error("Exception in createProductWithVariant:", err);
    return { success: false, error: err?.message || "Failed to create product" };
  }
}

export interface UpdateProductParams {
  variantId: string;
  modelNumber: string;
  variantName: string;
  hsnCode: string;
  attributes?: Record<string, string>;
  sellingPrice: number;
  mrp: number;
  purchasePrice?: number | null;
  lowStockThreshold?: number;
}

/**
 * Updates an existing product variant and updates the purchase price
 * in the private product_costs table (Owner only RPC).
 */
export async function updateProductVariantDetails(
  params: UpdateProductParams
): Promise<{
  success: boolean;
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { success: false, error: "Database not connected" };
  }

  try {
    const { data, error } = await supabase.rpc("update_product_variant_details", {
      p_variant_id: params.variantId,
      p_variant_name: params.variantName.trim(),
      p_model_number: params.modelNumber.trim(),
      p_hsn_code: params.hsnCode.trim(),
      p_attributes: params.attributes || {},
      p_selling_price: params.sellingPrice,
      p_mrp: params.mrp,
      p_purchase_price: params.purchasePrice ?? null,
      p_low_stock_threshold: params.lowStockThreshold ?? 2,
    });

    if (error) {
      console.error("RPC update_product_variant_details error:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Exception in updateProductVariantDetails:", err);
    return { success: false, error: err?.message || "Failed to update product details" };
  }
}

export interface KeepAliveStatus {
  lastPingAt: string | null;
  pingSource: string | null;
  error?: string;
}

/**
 * Fetches the most recent keep-alive ping timestamp from Supabase.
 * Useful for Owner Dashboard health status checks.
 */
export async function fetchLastKeepAliveTime(): Promise<KeepAliveStatus> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { lastPingAt: null, pingSource: null, error: "Database not connected" };
  }

  try {
    const { data, error } = await supabase
      .from("keep_alive")
      .select("last_ping_at, ping_source")
      .order("last_ping_at", { ascending: false })
      .limit(1);

    if (error) {
      return { lastPingAt: null, pingSource: null, error: error.message };
    }

    if (data && data.length > 0) {
      return {
        lastPingAt: data[0].last_ping_at,
        pingSource: data[0].ping_source,
      };
    }

    return { lastPingAt: null, pingSource: null };
  } catch (err: any) {
    return { lastPingAt: null, pingSource: null, error: err?.message };
  }
}
