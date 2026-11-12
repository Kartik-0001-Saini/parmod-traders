-- ==============================================================================
-- Migration 005: Add HSN Code, Unique Model Guards & Owner Product Management
-- ==============================================================================
-- Purpose:
-- 1. Adds hsn_code to product_variants (indexed for fast tax grouping).
-- 2. Sets realistic showroom HSN codes for existing items (8450, 8418, 8415, 8528, etc.).
-- 3. Creates atomic procedure create_product_with_variant_and_cost (Owner only).
-- 4. Creates atomic procedure update_product_variant_details (Owner only).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Add HSN Code Column & Index
-- ------------------------------------------------------------------------------
ALTER TABLE public.product_variants
ADD COLUMN IF NOT EXISTS hsn_code TEXT NOT NULL DEFAULT '8450';

CREATE INDEX IF NOT EXISTS idx_product_variants_hsn ON public.product_variants(hsn_code);

-- ------------------------------------------------------------------------------
-- 2. Update Existing Seed Items with Official Electronics HSN Codes
-- ------------------------------------------------------------------------------
UPDATE public.product_variants pv
SET hsn_code = CASE
    WHEN c.slug = 'washing-machines' THEN '8450'
    WHEN c.slug = 'refrigerators' THEN '8418'
    WHEN c.slug = 'air-conditioners' THEN '8415'
    WHEN c.slug = 'led-tvs' THEN '8528'
    WHEN c.slug = 'air-coolers' THEN '8479'
    ELSE '8509'
END
FROM public.products p
JOIN public.categories c ON p.category_id = c.id
WHERE pv.product_id = p.id;

-- ------------------------------------------------------------------------------
-- 3. Stored Procedure: Create Product with Variant and Cost (Owner Only)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_with_variant_and_cost(
    p_category_id UUID,
    p_brand TEXT,
    p_name TEXT,
    p_variant_name TEXT,
    p_model_number TEXT,
    p_hsn_code TEXT,
    p_attributes JSONB,
    p_mrp NUMERIC,
    p_selling_price NUMERIC,
    p_purchase_price NUMERIC DEFAULT NULL,
    p_opening_stock INT DEFAULT 0,
    p_low_stock_threshold INT DEFAULT 2
)
RETURNS JSONB AS $$
DECLARE
    v_product_id UUID;
    v_variant_id UUID;
    v_existing_variant RECORD;
BEGIN
    -- 1. Security Check: Must be authenticated Owner
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'Access Denied: Only the Owner can create new products.';
    END IF;

    -- 2. Duplicate Model Number Check (Case-insensitive)
    SELECT id, variant_name INTO v_existing_variant
    FROM public.product_variants
    WHERE lower(trim(model_number)) = lower(trim(p_model_number))
    LIMIT 1;

    IF v_existing_variant.id IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_MODEL: Model number "%" already exists for item "%".',
            trim(p_model_number), v_existing_variant.variant_name;
    END IF;

    -- 3. Find or Create Base Product (Matching brand + name in same category)
    SELECT id INTO v_product_id
    FROM public.products
    WHERE category_id = p_category_id
      AND lower(trim(brand)) = lower(trim(p_brand))
      AND lower(trim(name)) = lower(trim(p_name))
    LIMIT 1;

    IF v_product_id IS NULL THEN
        INSERT INTO public.products (
            category_id,
            brand,
            name,
            is_active
        ) VALUES (
            p_category_id,
            trim(p_brand),
            trim(p_name),
            true
        ) RETURNING id INTO v_product_id;
    END IF;

    -- 4. Insert Product Variant (Separate item with its own stock and HSN)
    INSERT INTO public.product_variants (
        product_id,
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
        is_test_seed
    ) VALUES (
        v_product_id,
        trim(p_variant_name),
        trim(p_model_number),
        trim(COALESCE(p_hsn_code, '8450')),
        COALESCE(p_attributes, '{}'::jsonb),
        GREATEST(0, COALESCE(p_opening_stock, 0)),
        GREATEST(0, COALESCE(p_low_stock_threshold, 2)),
        GREATEST(0, p_selling_price),
        GREATEST(0, p_mrp),
        now(),
        true,
        false -- Real showroom inventory!
    ) RETURNING id INTO v_variant_id;

    -- 5. Insert Purchase Cost into Private product_costs Table
    IF p_purchase_price IS NOT NULL AND p_purchase_price >= 0 THEN
        INSERT INTO public.product_costs (
            variant_id,
            purchase_price
        ) VALUES (
            v_variant_id,
            p_purchase_price
        ) ON CONFLICT (variant_id) DO UPDATE
        SET purchase_price = EXCLUDED.purchase_price,
            updated_at = now();

        -- Also record in price_history
        INSERT INTO public.price_history (
            variant_id,
            price_type,
            old_price,
            new_price,
            change_reason,
            changed_by
        ) VALUES (
            v_variant_id,
            'purchase',
            NULL,
            p_purchase_price,
            'opening_product_cost',
            'Owner'
        );
    END IF;

    -- 6. Log Opening Stock in inventory_movements if > 0
    IF p_opening_stock > 0 THEN
        INSERT INTO public.inventory_movements (
            variant_id,
            change_qty,
            previous_stock,
            new_stock,
            reason,
            notes,
            performed_by,
            performed_by_user_id
        ) VALUES (
            v_variant_id,
            p_opening_stock,
            0,
            p_opening_stock,
            'stock_count',
            'Initial Opening Stock',
            'Owner',
            auth.uid()
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'product_id', v_product_id,
        'variant_id', v_variant_id,
        'model_number', trim(p_model_number)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 4. Stored Procedure: Update Product Variant Details (Owner Only)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_variant_details(
    p_variant_id UUID,
    p_variant_name TEXT,
    p_model_number TEXT,
    p_hsn_code TEXT,
    p_attributes JSONB,
    p_selling_price NUMERIC,
    p_mrp NUMERIC,
    p_purchase_price NUMERIC DEFAULT NULL,
    p_low_stock_threshold INT DEFAULT 2
)
RETURNS JSONB AS $$
DECLARE
    v_old_purchase_price NUMERIC;
    v_existing_id UUID;
BEGIN
    -- Security Check: Must be authenticated Owner
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'Access Denied: Only the Owner can edit product details.';
    END IF;

    -- Check if new model number conflicts with another item
    SELECT id INTO v_existing_id
    FROM public.product_variants
    WHERE lower(trim(model_number)) = lower(trim(p_model_number))
      AND id != p_variant_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
        RAISE EXCEPTION 'DUPLICATE_MODEL: Model number "%" is already used by another item.', trim(p_model_number);
    END IF;

    -- Update variant
    UPDATE public.product_variants
    SET variant_name = trim(p_variant_name),
        model_number = trim(p_model_number),
        hsn_code = trim(COALESCE(p_hsn_code, '8450')),
        attributes = COALESCE(p_attributes, attributes),
        selling_price = GREATEST(0, p_selling_price),
        mrp = GREATEST(0, p_mrp),
        low_stock_threshold = GREATEST(0, COALESCE(p_low_stock_threshold, low_stock_threshold)),
        updated_at = now()
    WHERE id = p_variant_id;

    -- Update purchase price if provided
    IF p_purchase_price IS NOT NULL AND p_purchase_price >= 0 THEN
        SELECT purchase_price INTO v_old_purchase_price
        FROM public.product_costs
        WHERE variant_id = p_variant_id;

        INSERT INTO public.product_costs (
            variant_id,
            purchase_price
        ) VALUES (
            p_variant_id,
            p_purchase_price
        ) ON CONFLICT (variant_id) DO UPDATE
        SET purchase_price = EXCLUDED.purchase_price,
            updated_at = now();

        IF v_old_purchase_price IS DISTINCT FROM p_purchase_price THEN
            INSERT INTO public.price_history (
                variant_id,
                price_type,
                old_price,
                new_price,
                change_reason,
                changed_by
            ) VALUES (
                p_variant_id,
                'purchase',
                v_old_purchase_price,
                p_purchase_price,
                'manual_edit',
                'Owner'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'variant_id', p_variant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public/anon, grant to authenticated
REVOKE ALL ON FUNCTION public.create_product_with_variant_and_cost FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_variant_and_cost TO authenticated;

REVOKE ALL ON FUNCTION public.update_product_variant_details FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_variant_details TO authenticated;
