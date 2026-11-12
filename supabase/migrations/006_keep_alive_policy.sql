-- ==============================================================================
-- Migration 006: Hardened Keep-Alive Configuration for Supabase Free Tier
-- ==============================================================================
-- Purpose:
-- 1. Updates keep_alive table to support auto-incrementing ping audit records.
-- 2. Strictly locks down write access: anonymous/public users CANNOT write.
-- 3. Only the authenticated service_role (GitHub Actions worker) can write.
-- 4. Allows SELECT for anyone/owner so health status is visible on dashboard.
-- 5. Automatically retains the last 100 pings (~200 days) to keep storage minimal.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Ensure Table Structure & Auto-Incrementing Sequence
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.keep_alive (
    id BIGINT PRIMARY KEY,
    last_ping_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ping_source TEXT NOT NULL DEFAULT 'github-actions'
);

-- Sequence for auto-incrementing ID so every new ping adds a clean row
CREATE SEQUENCE IF NOT EXISTS public.keep_alive_id_seq;

-- Set sequence current value to max(id) or 1
SELECT setval('public.keep_alive_id_seq', COALESCE((SELECT MAX(id) FROM public.keep_alive), 1));

-- Set column default to fetch nextval from sequence
ALTER TABLE public.keep_alive 
ALTER COLUMN id SET DEFAULT nextval('public.keep_alive_id_seq');

-- Ensure initial seed record exists
INSERT INTO public.keep_alive (id, last_ping_at, ping_source)
VALUES (1, now(), 'migration_006')
ON CONFLICT (id) DO UPDATE 
SET last_ping_at = now(),
    ping_source = 'migration_006';

-- ------------------------------------------------------------------------------
-- 2. Automatic Retention Trigger (Keep last 100 pings, delete older)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_old_keep_alive_pings()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM public.keep_alive
    WHERE id NOT IN (
        SELECT id FROM public.keep_alive
        ORDER BY last_ping_at DESC
        LIMIT 100
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_prune_keep_alive ON public.keep_alive;
CREATE TRIGGER trg_prune_keep_alive
AFTER INSERT ON public.keep_alive
FOR EACH STATEMENT
EXECUTE FUNCTION public.prune_old_keep_alive_pings();

-- ------------------------------------------------------------------------------
-- 3. Security Hardening: Row Level Security (RLS) & Role Grants
-- ------------------------------------------------------------------------------
ALTER TABLE public.keep_alive ENABLE ROW LEVEL SECURITY;

-- Revoke all write permissions from public and anon
REVOKE ALL ON public.keep_alive FROM PUBLIC, anon;
REVOKE ALL ON SEQUENCE public.keep_alive_id_seq FROM PUBLIC, anon;

-- Allow reading so showroom UI and Owner Dashboard can show "Last Ping Time"
GRANT SELECT ON public.keep_alive TO anon, authenticated;

-- Allow service_role (GitHub Actions with secret key) full control
GRANT ALL ON public.keep_alive TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.keep_alive_id_seq TO service_role;

-- Drop any previous conflicting policies
DROP POLICY IF EXISTS "Anyone can read keep_alive" ON public.keep_alive;
DROP POLICY IF EXISTS "Anyone can view keep_alive" ON public.keep_alive;
DROP POLICY IF EXISTS "Owner can update keep_alive" ON public.keep_alive;
DROP POLICY IF EXISTS "Automated ping can update keep_alive" ON public.keep_alive;
DROP POLICY IF EXISTS "Allow reading keep_alive" ON public.keep_alive;

-- RLS Policy: Anyone can SELECT
CREATE POLICY "Allow reading keep_alive"
ON public.keep_alive FOR SELECT
USING (true);

-- NOTE: No INSERT/UPDATE/DELETE policy is granted to anon or authenticated.
-- The Supabase service_role key automatically BYPASSES RLS, so GitHub Actions
-- can perform real database writes while the browser/anon key is completely locked out.
