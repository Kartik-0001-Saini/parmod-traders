import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { ProductItem, INITIAL_PRODUCTS, InventoryMovementRecord } from "@/lib/mock-data";

/**
 * BEGINNER LESSON: Service Layer Pattern
 * Instead of writing database queries inside UI buttons, we put all data fetching
 * and stock logic into this Inventory Service.
 * If Supabase is connected, it uses real cloud PostgreSQL.
 * If credentials are not yet entered, it gracefully falls back so the app never crashes!
 */

export interface DbCategory {
  id: string;
  name: string;
  nameHi: string;
  slug: string;
  icon: string;
}

export async function fetchShowroomCategories(): Promise<DbCategory[]> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    // Fallback categories
    return [
      { id: "all", name: "All Items", nameHi: "सभी सामान", slug: "all", icon: "🏷️" },
      { id: "wm", name: "Washing Machines", nameHi: "वॉशिंग मशीन", slug: "washing-machines", icon: "🧺" },
      { id: "ref", name: "Refrigerators", nameHi: "फ्रिज", slug: "refrigerators", icon: "❄️" },
      { id: "ac", name: "Air Conditioners", nameHi: "एसी (AC)", slug: "air-conditioners", icon: "💨" },
      { id: "tv", name: "LED TVs", nameHi: "एलईडी टीवी", slug: "led-tvs", icon: "📺" },
      { id: "cooler", name: "Air Coolers", nameHi: "कूलर", slug: "air-coolers", icon: "🌀" },
      { id: "other", name: "Other Electronics", nameHi: "अन्य सामान", slug: "other", icon: "🔌" },
    ];
  }

  try {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, name_hi, slug, icon, display_order")
      .order("display_order", { ascending: true });

    if (error || !data || data.length === 0) {
      console.warn("Could not fetch categories from Supabase, using defaults:", error?.message);
      return [];
    }

    return data.map((c) => ({
      id: c.id,
      name: c.name,
      nameHi: c.name_hi,
      slug: c.slug,
      icon: c.icon,
    }));
  } catch (err) {
    console.error("Error fetching categories:", err);
    return [];
  }
}

/**
 * Fetches all active showroom product variants from Supabase.
 * Each variant is treated as an independent item with its own stock and model number.
 */
export async function fetchShowroomProducts(): Promise<{
  products: ProductItem[];
  isFromSupabase: boolean;
}> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    return { products: INITIAL_PRODUCTS, isFromSupabase: false };
  }

  try {
    const { data, error } = await supabase
      .from("product_variants")
      .select(`
        id,
        variant_name,
        model_number,
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
            name,
            name_hi,
            slug
          )
        )
      `)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error || !data || data.length === 0) {
      console.warn("No Supabase products found or error occurred, using seed data:", error?.message);
      return { products: INITIAL_PRODUCTS, isFromSupabase: false };
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
        currentStock: item.current_stock,
        lowStockThreshold: item.low_stock_threshold || 2,
        sellingPrice: Number(item.selling_price),
        mrp: Number(item.mrp),
        lastVerifiedDate: item.last_verified_at || new Date().toISOString(),
        imageUrl: prod.image_url,
        specifications: item.attributes || {},
      };
    });

    return { products: transformed, isFromSupabase: true };
  } catch (err) {
    console.error("Exception fetching products from Supabase:", err);
    return { products: INITIAL_PRODUCTS, isFromSupabase: false };
  }
}

/**
 * Executes a stock movement atomically on Supabase.
 * Uses the database stored procedure `execute_stock_movement`
 * which enforces stock >= 0 and records the movement history in one transaction.
 */
export async function executeStockChange(params: {
  variantId: string;
  changeQty: number; // -1 for sale, +1 for return
  reason: "sale" | "return" | "manual_correction" | "stock_count";
  performedBy: string;
  notes?: string;
}): Promise<{
  success: boolean;
  newStock?: number;
  previousStock?: number;
  movementId?: string;
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();

  if (!supabase) {
    // Local simulation when Supabase credentials are not yet configured
    return { success: true };
  }

  try {
    const { data, error } = await supabase.rpc("execute_stock_movement", {
      p_variant_id: params.variantId,
      p_change_qty: params.changeQty,
      p_reason: params.reason,
      p_performed_by: params.performedBy,
      p_notes: params.notes || null,
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

  if (!supabase) {
    return [];
  }

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
        product_variants (
          variant_name,
          model_number,
          products (
            name
          )
        )
      `)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error || !data) {
      console.warn("Could not fetch movements from Supabase:", error?.message);
      return [];
    }

    return data.map((m: any) => {
      const variant = m.product_variants || {};
      const prod = variant.products || {};

      return {
        id: m.id,
        productId: m.variant_id,
        productName: prod.name || "Showroom Item",
        variant: variant.variant_name || "",
        modelNumber: variant.model_number || "",
        type: m.reason === "sale" ? "sale" : m.reason === "return" ? "return" : "correction",
        quantityChange: m.change_qty,
        previousStock: m.previous_stock,
        newStock: m.new_stock,
        reason: m.notes || m.reason,
        timestamp: m.created_at,
        performedBy: m.performed_by,
      };
    });
  } catch (err) {
    console.error("Exception fetching movement history:", err);
    return [];
  }
}
