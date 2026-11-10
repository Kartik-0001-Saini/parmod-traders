-- ==============================================================================
-- Migration 001: Initial Schema for Parmod Traders Smart Inventory
-- ==============================================================================
-- Description: Creates extensible categories, products, variants, movements log,
-- price history, bills, and keep_alive tables with strict constraints and RLS.
-- ==============================================================================

-- 1. Enable UUID Extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 2. Profiles Table (User Roles: Owner vs Staff)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
    full_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper function to check if current user is Owner
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'owner'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 3. Categories Table (Dynamic categories for Electronics Showroom)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_hi TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT '🏷️',
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 4. Category Attributes Table (Flexible attributes per category)
-- Allows adding new specs (e.g. "Capacity", "Star Rating", "Screen Size") anytime!
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.category_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_hi TEXT NOT NULL,
    attribute_type TEXT NOT NULL DEFAULT 'text', -- 'text', 'select', 'number'
    options JSONB, -- Array of selectable choices, e.g. ["8 KG", "7 KG", "6 KG"]
    is_required BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. Products Table (Base product model line)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    brand TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 6. Product Variants Table (EVERY variant is a separate item with its own stock!)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    variant_name TEXT NOT NULL,
    model_number TEXT NOT NULL UNIQUE, -- Crucial for electronics showroom matching
    barcode TEXT,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb, -- Flexible specs (capacity, color, etc.)
    current_stock INT NOT NULL DEFAULT 0 CHECK (current_stock >= 0), -- STRICT RULE: NEVER BELOW 0!
    low_stock_threshold INT NOT NULL DEFAULT 2 CHECK (low_stock_threshold >= 0),
    selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price >= 0),
    mrp NUMERIC(12,2) NOT NULL CHECK (mrp >= 0),
    latest_purchase_price NUMERIC(12,2) CHECK (latest_purchase_price >= 0),
    last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_test_seed BOOLEAN NOT NULL DEFAULT false, -- Keeps test seed data clearly separated!
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for instant model number and brand lookups
CREATE INDEX IF NOT EXISTS idx_product_variants_model ON public.product_variants(model_number);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);

-- ------------------------------------------------------------------------------
-- 7. Inventory Movements Table (Audit log for EVERY single stock change)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
    change_qty INT NOT NULL, -- -1 for sale, +1 for return
    previous_stock INT NOT NULL,
    new_stock INT NOT NULL CHECK (new_stock >= 0), -- Must never be negative
    reason TEXT NOT NULL CHECK (reason IN ('sale', 'return', 'purchase_bill', 'manual_correction', 'stock_count')),
    notes TEXT,
    performed_by TEXT NOT NULL DEFAULT 'Showroom Staff',
    performed_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    bill_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movements_variant ON public.inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_movements_created_at ON public.inventory_movements(created_at DESC);

-- ------------------------------------------------------------------------------
-- 8. Price History Table (Never delete old prices!)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    price_type TEXT NOT NULL CHECK (price_type IN ('purchase', 'selling', 'mrp')),
    old_price NUMERIC(12,2),
    new_price NUMERIC(12,2) NOT NULL,
    change_reason TEXT,
    bill_id UUID,
    changed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 9. Bills Table (Uploaded supplier purchase bills)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_name TEXT NOT NULL,
    invoice_number TEXT,
    invoice_date DATE,
    total_amount NUMERIC(12,2),
    file_url TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracted', 'verified', 'rejected')),
    extracted_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Duplicate prevention constraint when invoice number is known
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_supplier_invoice
ON public.bills (supplier_name, invoice_number)
WHERE invoice_number IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 10. Keep Alive Table (Free-tier Supabase anti-pause mechanism)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.keep_alive (
    id INT PRIMARY KEY DEFAULT 1,
    last_ping_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ping_source TEXT NOT NULL DEFAULT 'github-actions'
);

-- Insert the single row if not already present
INSERT INTO public.keep_alive (id, last_ping_at, ping_source)
VALUES (1, now(), 'initial_migration')
ON CONFLICT (id) DO UPDATE SET last_ping_at = now();

-- ------------------------------------------------------------------------------
-- 11. Atomic Function: Record Stock Movement Safely
-- Guarantees stock change and movement history write occur in ONE transaction.
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
    v_result JSONB;
BEGIN
    -- 1. Lock the variant row for update to prevent race conditions
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

    -- 3. Update the stock and refresh last_verified_at
    UPDATE public.product_variants
    SET current_stock = v_new_stock,
        last_verified_at = now(),
        updated_at = now()
    WHERE id = p_variant_id;

    -- 4. Record in inventory_movements
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

    -- 5. Build response object
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

-- ------------------------------------------------------------------------------
-- 12. Enable Row Level Security (RLS) on ALL tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.keep_alive ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 13. RLS Policies
-- ------------------------------------------------------------------------------

-- Categories: Public read, Owner edit
CREATE POLICY "Anyone can view categories"
ON public.categories FOR SELECT
USING (true);

CREATE POLICY "Owners can manage categories"
ON public.categories FOR ALL
USING (public.is_owner());

-- Category Attributes: Public read, Owner edit
CREATE POLICY "Anyone can view category attributes"
ON public.category_attributes FOR SELECT
USING (true);

CREATE POLICY "Owners can manage category attributes"
ON public.category_attributes FOR ALL
USING (public.is_owner());

-- Products: Public read active products, Owner full access
CREATE POLICY "Anyone can view active products"
ON public.products FOR SELECT
USING (is_active = true);

CREATE POLICY "Owners can manage products"
ON public.products FOR ALL
USING (public.is_owner());

-- Product Variants: Public read active variants, Owner full access
CREATE POLICY "Anyone can view active product variants"
ON public.product_variants FOR SELECT
USING (is_active = true);

CREATE POLICY "Owners can manage product variants"
ON public.product_variants FOR ALL
USING (public.is_owner());

-- Inventory Movements: Anyone can view, Authenticated/Staff can insert via function
CREATE POLICY "Anyone can view inventory movements"
ON public.inventory_movements FOR SELECT
USING (true);

CREATE POLICY "Staff and Owner can record movements"
ON public.inventory_movements FOR INSERT
WITH CHECK (true);

-- Price History: Owner only
CREATE POLICY "Owners can view price history"
ON public.price_history FOR SELECT
USING (public.is_owner());

CREATE POLICY "Owners can insert price history"
ON public.price_history FOR INSERT
WITH CHECK (public.is_owner());

-- Bills: Owner only
CREATE POLICY "Owners can view bills"
ON public.bills FOR SELECT
USING (public.is_owner());

CREATE POLICY "Owners can manage bills"
ON public.bills FOR ALL
USING (public.is_owner());

-- Keep Alive: Anyone can view, automated scripts can update
CREATE POLICY "Anyone can read keep_alive"
ON public.keep_alive FOR SELECT
USING (true);

CREATE POLICY "Automated ping can update keep_alive"
ON public.keep_alive FOR UPDATE
USING (true);
