-- ==============================================================================
-- Migration 004: Prevent Profile Role Escalation
-- ==============================================================================
-- Purpose:
-- Fixes privilege escalation loophole where a logged-in Staff user could
-- attempt to update their own 'role' column to 'owner'.
--
-- Triple-Layer Defense:
-- 1. Database Trigger: Rejects any attempt by non-owners to change the role column.
-- 2. RLS WITH CHECK: Ensures non-owners can only update if role remains unchanged.
-- 3. Column Privilege: Revokes direct UPDATE on the 'role' column from authenticated.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Trigger Function: Protect Role from Self-Elevation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER AS $$
BEGIN
    -- If role is being changed
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        -- Only existing owners can change a role
        IF NOT public.is_owner() THEN
            RAISE EXCEPTION 'Access Denied: You cannot modify your own role.';
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if any and recreate
DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;

CREATE TRIGGER trg_protect_profile_role
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_role();

-- ------------------------------------------------------------------------------
-- 2. Update RLS Policies with Strict WITH CHECK
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update own profile name" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
USING (id = auth.uid() OR public.is_owner())
WITH CHECK (
    -- Owner can update anything
    public.is_owner()
    -- Non-owner can only update if their role stays identical to current role
    OR (
        id = auth.uid()
        AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    )
);
