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
 * Fetches all active showroom product variants from Supabase.
 * NOTE: Sensitive purchase prices are NOT in this table anymore!
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
 * Fetches the confidential purchase price for a variant.
 * Strictly protected by PostgreSQL Row Level Security (RLS).
 * If caller is not Owner, PostgreSQL returns 0 rows!
 */
export async function fetchProductCost(variantId: string): Promise<number | null> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("product_costs")
      .select("purchase_price")
      .eq("variant_id", variantId)
      .single();

    if (error || !data) {
      // Forbidden or not found
      return null;
    }

    return Number(data.purchase_price);
  } catch {
    return null;
  }
}

/**
 * Executes a stock movement atomically on Supabase.
 * Requires logged-in Staff or Owner session.
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
