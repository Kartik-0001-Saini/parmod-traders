-- ==============================================================================
-- Migration 010: Bill Workflow for Real-World Distributor Invoices
-- Parmod Traders Smart Inventory
--
-- Features:
-- 1. Updates bills table for multi-page support (pages JSONB), e-invoice IRN,
--    distributor GSTIN, tax breakdowns (CGST, SGST, IGST), total pieces,
--    continuation warning, and showroom pricing basis ('incl_tax' vs 'excl_tax').
-- 2. Adds unique indexes for IRN and (supplier_gstin, invoice_number).
-- 3. Creates 'suppliers' registry table for distributors (e.g. Jindal Electronics).
-- 4. Creates 'bill_lines' table with complete line fields (category, brand,
--    size_spec, model_candidate, series_name, raw_description, HSN, quantity,
--    rate_incl_tax, rate_excl_tax, line_amount, matching).
-- 5. Creates 'supplier_item_aliases' table for Supplier Item Memory (remembers
--    "distributor GSTIN + exact description string -> showroom variant").
-- 6. Adds 'purchase_price_excl_tax' to product_costs and price_history.
-- 7. Configures Owner-only RLS policies on all new tables.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Enhance public.bills for multi-page and distributor e-invoice data
-- ------------------------------------------------------------------------------
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS pages JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS irn TEXT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS supplier_gstin TEXT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS subtotal_excl_tax NUMERIC(12,2);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12,2);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12,2);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS total_pieces INT;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS page_count INT DEFAULT 1;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS has_continuation_warning BOOLEAN DEFAULT false;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS pricing_basis TEXT DEFAULT 'incl_tax';

-- Safe constraint for pricing basis
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_pricing_basis_check;
ALTER TABLE public.bills ADD CONSTRAINT bills_pricing_basis_check
    CHECK (pricing_basis IN ('incl_tax', 'excl_tax'));

-- Unique index on e-invoice IRN (when present and non-empty)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_irn
ON public.bills (irn)
WHERE irn IS NOT NULL AND trim(irn) <> '';

-- Unique index on distributor GSTIN + invoice number (when present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_gstin_invoice
ON public.bills (lower(trim(supplier_gstin)), lower(trim(invoice_number)))
WHERE supplier_gstin IS NOT NULL AND invoice_number IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Suppliers Registry Table (Distributors like Jindal Electronics)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    gstin TEXT UNIQUE,
    phone TEXT,
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view suppliers" ON public.suppliers;
CREATE POLICY "Anyone can view suppliers"
ON public.suppliers FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Owners can manage suppliers" ON public.suppliers;
CREATE POLICY "Owners can manage suppliers"
ON public.suppliers FOR ALL
USING (public.is_owner());

-- ------------------------------------------------------------------------------
-- 3. Bill Lines Table (Individual Line Items on a Bill)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bill_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    line_number INT NOT NULL DEFAULT 1,
    raw_description TEXT NOT NULL,
    category TEXT,
    brand TEXT,
    size_spec TEXT,
    model_candidate TEXT,
    series_name TEXT,
    hsn_code TEXT,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    rate_incl_tax NUMERIC(10,2),
    rate_excl_tax NUMERIC(10,2),
    line_amount NUMERIC(12,2),
    gst_rate NUMERIC(5,2),
    is_uncertain BOOLEAN DEFAULT false,
    uncertain_fields TEXT[] DEFAULT '{}',
    matched_variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
    match_type TEXT CHECK (match_type IN ('memory_alias', 'model_number', 'fuzzy_specs', 'manual', 'new_product')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bill_lines_bill_id
ON public.bill_lines (bill_id);

ALTER TABLE public.bill_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view bill lines" ON public.bill_lines;
CREATE POLICY "Owners can view bill lines"
ON public.bill_lines FOR SELECT
USING (public.is_owner());

DROP POLICY IF EXISTS "Owners can manage bill lines" ON public.bill_lines;
CREATE POLICY "Owners can manage bill lines"
ON public.bill_lines FOR ALL
USING (public.is_owner());

-- ------------------------------------------------------------------------------
-- 4. Supplier Item Aliases Table (Supplier Item Memory)
-- Remembers: "distributor GSTIN + exact description string -> showroom variant"
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.supplier_item_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_gstin TEXT NOT NULL,
    raw_description TEXT NOT NULL,
    clean_description TEXT NOT NULL,
    variant_id UUID NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supplier_alias UNIQUE (supplier_gstin, clean_description)
);

CREATE INDEX IF NOT EXISTS idx_supplier_aliases_lookup
ON public.supplier_item_aliases (supplier_gstin, clean_description);

ALTER TABLE public.supplier_item_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view supplier aliases" ON public.supplier_item_aliases;
CREATE POLICY "Owners can view supplier aliases"
ON public.supplier_item_aliases FOR SELECT
USING (public.is_owner());

DROP POLICY IF EXISTS "Owners can manage supplier aliases" ON public.supplier_item_aliases;
CREATE POLICY "Owners can manage supplier aliases"
ON public.supplier_item_aliases FOR ALL
USING (public.is_owner());

-- ------------------------------------------------------------------------------
-- 5. Dual Rate Columns (Rate incl. tax vs excl. tax)
-- ------------------------------------------------------------------------------
ALTER TABLE public.product_costs ADD COLUMN IF NOT EXISTS purchase_price_excl_tax NUMERIC(10,2);
ALTER TABLE public.price_history ADD COLUMN IF NOT EXISTS old_price_excl_tax NUMERIC(10,2);
ALTER TABLE public.price_history ADD COLUMN IF NOT EXISTS new_price_excl_tax NUMERIC(10,2);
