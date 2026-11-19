-- ==============================================================================
-- Migration 009: Purchase Bill Workflow (Sub-Phase A: Storage & Security)
-- Parmod Traders Smart Inventory
--
-- Features:
-- 1. Updates bills.status CHECK constraint to include 'checked' and 'confirmed'.
-- 2. Adds unique index on file_hash to prevent duplicate uploads of the same file.
-- 3. Adds tracking columns: confirmed_at, confirmed_by, uploaded_by.
-- 4. Auto-sets uploaded_by from auth.uid() using a secure trigger.
-- 5. Creates private 'bills' storage bucket (public = false) with ON CONFLICT DO NOTHING.
-- 6. Adds Owner-only storage policies on storage.objects (read, insert, update, delete).
--    (No ALTER, GRANT, or REVOKE on storage tables; RLS is already on by default).
-- ==============================================================================

-- 1. Update status check constraint on public.bills safely
ALTER TABLE public.bills DROP CONSTRAINT IF EXISTS bills_status_check;
ALTER TABLE public.bills ADD CONSTRAINT bills_status_check
    CHECK (status IN ('uploaded', 'extracted', 'checked', 'verified', 'confirmed', 'rejected'));

-- 2. Prevent duplicate bill files by SHA-256 hash
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_file_hash
ON public.bills (file_hash);

-- 3. Add tracking columns for bills
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id);
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id);

-- 4. Automatically populate uploaded_by from auth.uid()
CREATE OR REPLACE FUNCTION public.set_bill_uploaded_by()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.uploaded_by IS NULL THEN
        NEW.uploaded_by := auth.uid();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_set_bill_uploaded_by ON public.bills;
CREATE TRIGGER trigger_set_bill_uploaded_by
BEFORE INSERT ON public.bills
FOR EACH ROW
EXECUTE FUNCTION public.set_bill_uploaded_by();

-- 5. Create the private 'bills' storage bucket if it does not exist
-- (10MB limit, allowed types: PDF, JPG, JPEG, PNG, public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'bills',
    'bills',
    false,
    10485760, -- 10MB limit
    ARRAY['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 6. Storage RLS Policies for 'bills' bucket: strictly Owner-only
-- (Only DROP POLICY IF EXISTS and CREATE POLICY; no ALTER TABLE)
DROP POLICY IF EXISTS "Owner bills read access" ON storage.objects;
CREATE POLICY "Owner bills read access"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'bills' AND public.is_owner());

DROP POLICY IF EXISTS "Owner bills insert access" ON storage.objects;
CREATE POLICY "Owner bills insert access"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'bills' AND public.is_owner());

DROP POLICY IF EXISTS "Owner bills update access" ON storage.objects;
CREATE POLICY "Owner bills update access"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'bills' AND public.is_owner());

DROP POLICY IF EXISTS "Owner bills delete access" ON storage.objects;
CREATE POLICY "Owner bills delete access"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'bills' AND public.is_owner());
