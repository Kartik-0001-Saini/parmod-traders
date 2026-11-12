-- ==============================================================================
-- Migration 003: Security & Auth Hardening (Production-Ready Guardrails)
-- ==============================================================================
-- Purpose:
-- 1. Move purchase costs into a strictly private table (product_costs) readable only by Owner.
-- 2. Drop sensitive cost columns from public product_variants table.
-- 3. Lock execute_stock_movement function so only logged-in Staff or Owner can run it.
-- 4. Revoke direct write permissions on inventory_movements and product_variants.
-- 5. Restrict keep_alive table to service_role only (GitHub Actions secret key).
-- 6. Ensure strict Role-Based Access Control (RBAC) for 'owner' and 'staff'.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create Private Table: product_costs (Owner Only)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_costs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL UNIQUE REFERENCES public.product_variants(id) ON DELETE CASCADE,
    purchase_price NUMERIC(12,2) NOT NULL CHECK (purchase_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safely migrate any existing purchase prices from product_variants
INSERT INTO public.product_costs (variant_id, purchase_price)
SELECT id, latest_purchase_price
FROM public.product_variants
WHERE latest_purchase_price IS NOT NULL
ON CONFLICT (variant_id) DO UPDATE SET purchase_price = EXCLUDED.purchase_price;

-- Now permanently remove the sensitive cost column from the public table!
ALTER TABLE public.product_variants DROP COLUMN IF EXISTS latest_purchase_price;

-- ------------------------------------------------------------------------------
-- 2. Role Verification Functions
-- ------------------------------------------------------------------------------

-- Function: Check if current authenticated user is an Owner
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function: Check if current authenticated user is Staff
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'staff'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function: Check if user is either Staff or Owner
CREATE OR REPLACE FUNCTION public.is_staff_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('owner', 'staff')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------------------------
-- 3. Lock Down execute_stock_movement Function
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_stock_movement(
    p_variant_id UUID,
    p_change_qty INT,
    p_reason TEXT,
    p_performed_by TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_prev_stock INT;
    v_new_stock INT;
    v_movement_id UUID;
    v_user_role TEXT;
    v_result JSONB;
BEGIN
    -- GUARD 1: Must be logged in via Supabase Auth
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Access Denied: You must be logged in to update stock.';
    END IF;

    -- GUARD 2: Must be either Staff or Owner
    SELECT role INTO v_user_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'staff') THEN
        RAISE EXCEPTION 'Access Denied: Your account does not have permission to modify stock.';
    END IF;

    -- GUARD 3: Staff can ONLY do 'sale' or 'return'. Only Owner can do 'manual_correction' or 'stock_count'
    IF v_user_role = 'staff' AND p_reason NOT IN ('sale', 'return') THEN
        RAISE EXCEPTION 'Access Denied: Staff accounts can only record sales or customer returns.';
    END IF;

    -- 1. Lock the variant row for update to prevent concurrent race conditions
    SELECT current_stock INTO v_prev_stock
    FROM public.product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product variant with ID % not found', p_variant_id;
    END IF;

    -- 2. Calculate new stock
    v_new_stock := v_prev_stock + p_change_qty;

    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'Stock cannot go below 0. Current stock is %, requested change is %', v_prev_stock, p_change_qty;
    END IF;

    -- 3. Update stock and refresh last_verified_at
    UPDATE public.product_variants
    SET current_stock = v_new_stock,
        last_verified_at = now(),
        updated_at = now()
    WHERE id = p_variant_id;

    -- 4. Record the audit event in inventory_movements
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
        p_variant_id,
        p_change_qty,
        v_prev_stock,
        v_new_stock,
        p_reason,
        p_notes,
        p_performed_by,
        auth.uid()
    ) RETURNING id INTO v_movement_id;

    -- 5. Build response
    v_result := jsonb_build_object(
        'success', true,
        'variant_id', p_variant_id,
        'previous_stock', v_prev_stock,
        'new_stock', v_new_stock,
        'movement_id', v_movement_id
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public and anon
REVOKE ALL ON FUNCTION public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

-- Grant execute to authenticated users ONLY
GRANT EXECUTE ON FUNCTION public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. Revoke Direct Client Table Modifications
-- Prevent client scripts from directly inserting or modifying stock
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff and Owner can record movements" ON public.inventory_movements;
REVOKE INSERT, UPDATE, DELETE ON public.inventory_movements FROM anon, authenticated;

-- Direct stock changes on product_variants can ONLY be done by Owner
DROP POLICY IF EXISTS "Owners can manage product variants" ON public.product_variants;
CREATE POLICY "Owners can manage product variants"
ON public.product_variants FOR ALL
USING (public.is_owner());

-- ------------------------------------------------------------------------------
-- 5. Row Level Security for Private Table: product_costs
-- ------------------------------------------------------------------------------
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view product costs" ON public.product_costs;
CREATE POLICY "Owners can view product costs"
ON public.product_costs FOR SELECT
USING (public.is_owner());

DROP POLICY IF EXISTS "Owners can insert product costs" ON public.product_costs;
CREATE POLICY "Owners can insert product costs"
ON public.product_costs FOR INSERT
WITH CHECK (public.is_owner());

DROP POLICY IF EXISTS "Owners can update product costs" ON public.product_costs;
CREATE POLICY "Owners can update product costs"
ON public.product_costs FOR UPDATE
USING (public.is_owner());

DROP POLICY IF EXISTS "Owners can delete product costs" ON public.product_costs;
CREATE POLICY "Owners can delete product costs"
ON public.product_costs FOR DELETE
USING (public.is_owner());

-- ------------------------------------------------------------------------------
-- 6. Restrict keep_alive Table
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Automated ping can update keep_alive" ON public.keep_alive;

-- Anyone can read keep_alive for dashboard health checks
DROP POLICY IF EXISTS "Anyone can read keep_alive" ON public.keep_alive;
CREATE POLICY "Anyone can read keep_alive"
ON public.keep_alive FOR SELECT
USING (true);

-- Only authenticated Owner can manually update keep_alive from UI;
-- The GitHub Actions scheduled worker will use SUPABASE_SERVICE_ROLE_KEY to bypass RLS.
CREATE POLICY "Owner can update keep_alive"
ON public.keep_alive FOR UPDATE
USING (public.is_owner());

-- ------------------------------------------------------------------------------
-- 7. Profiles Table RLS Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT
USING (id = auth.uid() OR public.is_owner());

DROP POLICY IF EXISTS "Users can update own profile name" ON public.profiles;
CREATE POLICY "Users can update own profile name"
ON public.profiles FOR UPDATE
USING (id = auth.uid() OR public.is_owner());
