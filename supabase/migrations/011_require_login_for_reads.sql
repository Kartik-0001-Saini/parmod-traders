-- ==============================================================================
-- Migration 011: Require Login to Read Showroom Data
-- Parmod Traders Smart Inventory
--
-- Before: categories, category attributes, products, product variants,
-- inventory movements (sales history) and suppliers could be read by ANYONE,
-- including visitors who are not logged in (the public "anon" key is visible
-- in the website's code, so hiding data in the page alone is not enough).
--
-- After: only logged-in accounts that have a profile with role 'owner' or
-- 'staff' can read them. Owner-only rules (costs, bills, price history) and
-- all write rules are unchanged.
--
-- Safe to run more than once.
-- ==============================================================================

BEGIN;

-- 1. Categories
DROP POLICY IF EXISTS "Anyone can view categories" ON public.categories;
DROP POLICY IF EXISTS "Staff and owner can view categories" ON public.categories;
CREATE POLICY "Staff and owner can view categories"
ON public.categories FOR SELECT
TO authenticated
USING (public.is_staff_or_owner());

-- 2. Category attributes
DROP POLICY IF EXISTS "Anyone can view category attributes" ON public.category_attributes;
DROP POLICY IF EXISTS "Staff and owner can view category attributes" ON public.category_attributes;
CREATE POLICY "Staff and owner can view category attributes"
ON public.category_attributes FOR SELECT
TO authenticated
USING (public.is_staff_or_owner());

-- 3. Products (active only; owners still see everything via "Owners can manage products")
DROP POLICY IF EXISTS "Anyone can view active products" ON public.products;
DROP POLICY IF EXISTS "Staff and owner can view active products" ON public.products;
CREATE POLICY "Staff and owner can view active products"
ON public.products FOR SELECT
TO authenticated
USING (is_active = true AND public.is_staff_or_owner());

-- 4. Product variants (active only; owners still see everything via "Owners can manage product variants")
DROP POLICY IF EXISTS "Anyone can view active product variants" ON public.product_variants;
DROP POLICY IF EXISTS "Staff and owner can view active product variants" ON public.product_variants;
CREATE POLICY "Staff and owner can view active product variants"
ON public.product_variants FOR SELECT
TO authenticated
USING (is_active = true AND public.is_staff_or_owner());

-- 5. Inventory movements (sales / returns / stock history)
DROP POLICY IF EXISTS "Anyone can view inventory movements" ON public.inventory_movements;
DROP POLICY IF EXISTS "Staff and owner can view inventory movements" ON public.inventory_movements;
CREATE POLICY "Staff and owner can view inventory movements"
ON public.inventory_movements FOR SELECT
TO authenticated
USING (public.is_staff_or_owner());

-- 6. Suppliers
DROP POLICY IF EXISTS "Anyone can view suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Staff and owner can view suppliers" ON public.suppliers;
CREATE POLICY "Staff and owner can view suppliers"
ON public.suppliers FOR SELECT
TO authenticated
USING (public.is_staff_or_owner());

COMMIT;
