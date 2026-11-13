-- ==============================================================================
-- Migration 008: Server-Side Identity Verification for execute_stock_movement
-- ==============================================================================
-- Purpose:
-- 1. Drops the old 6-argument execute_stock_movement function.
-- 2. Removes p_performed_by from the parameter list to prevent client-side spoofing.
-- 3. Derives performer identity strictly from cryptographic auth.uid().
-- 4. Automatically looks up the performer's display name from public.profiles.
-- 5. Preserves all business and security guards (Staff single-piece, undo ownership,
--    10-minute expiry, no double undo, no undo of an undo, non-negative stock floor).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Drop Old Function Signatures (Full Argument Lists)
-- ------------------------------------------------------------------------------
-- Drop 6-argument version from migration 007:
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT, UUID);

-- Drop previous 4-argument and 5-argument versions if any exist:
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT);

-- Drop 5-argument version so migration 008 is 100% safe to re-run:
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT, UUID);

-- ------------------------------------------------------------------------------
-- 2. Create Hardened 5-Argument execute_stock_movement Function
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_stock_movement(
    p_variant_id UUID,
    p_change_qty INT,
    p_reason TEXT,
    p_notes TEXT DEFAULT NULL,
    p_original_movement_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_prev_stock INT;
    v_new_stock INT;
    v_effective_change_qty INT;
    v_movement_id UUID;
    v_user_role TEXT;
    v_performer_name TEXT;
    v_orig RECORD;
BEGIN
    -- GUARD 1: Cryptographic Authentication Check (via Supabase Auth JWT)
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Access Denied: You must be logged in to update stock.';
    END IF;

    -- GUARD 2: Derive Role & Performer Name Strictly From Database Profile
    SELECT role, COALESCE(full_name, email, 'Staff') INTO v_user_role, v_performer_name
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'staff') THEN
        RAISE EXCEPTION 'Access Denied: Your account does not have permission to modify stock.';
    END IF;

    -- GUARD 3: Staff Single-Piece Limits (Staff can only sell -1 or return +1)
    IF v_user_role = 'staff' THEN
        IF p_reason NOT IN ('sale', 'return', 'undo') THEN
            RAISE EXCEPTION 'Access Denied: Staff accounts can only record sales, returns, or undos.';
        END IF;

        IF p_reason = 'sale' AND p_change_qty != -1 THEN
            RAISE EXCEPTION 'Invalid Quantity: Sale must have quantity -1 (single piece only).';
        END IF;

        IF p_reason = 'return' AND p_change_qty != 1 THEN
            RAISE EXCEPTION 'Invalid Quantity: Return must have quantity +1 (single piece only).';
        END IF;
    END IF;

    -- GUARD 4: Strict Server-Side Undo Verification
    IF p_reason = 'undo' THEN
        IF p_original_movement_id IS NULL THEN
            RAISE EXCEPTION 'Invalid Request: Undo requires a valid original movement ID.';
        END IF;

        -- Lock the original movement row
        SELECT * INTO v_orig
        FROM public.inventory_movements
        WHERE id = p_original_movement_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'ORIGINAL_MOVEMENT_NOT_FOUND: The action you are trying to undo does not exist.';
        END IF;

        -- No undo chaining: cannot undo an undo
        IF v_orig.reason = 'undo' THEN
            RAISE EXCEPTION 'CANNOT_UNDO_AN_UNDO: An undo action cannot be undone again.';
        END IF;

        -- Cannot undo twice
        IF v_orig.is_undone THEN
            RAISE EXCEPTION 'ALREADY_UNDONE: This action has already been undone.';
        END IF;

        -- 10-minute expiry window
        IF now() - v_orig.created_at > INTERVAL '10 minutes' THEN
            RAISE EXCEPTION 'UNDO_EXPIRED: The 10-minute undo window for this action has expired.';
        END IF;

        -- Staff can only undo their OWN action (checked against auth.uid())
        -- Owner can undo anyone's action
        IF v_user_role = 'staff' AND v_orig.performed_by_user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'UNAUTHORIZED_UNDO: Staff accounts can only undo actions they performed themselves.';
        END IF;

        -- Server forces variant & exact opposite quantity (Staff cannot spoof quantity)
        p_variant_id := v_orig.variant_id;
        v_effective_change_qty := -v_orig.change_qty;
    ELSE
        v_effective_change_qty := p_change_qty;
    END IF;

    -- GUARD 5: Lock Product Variant Row & Enforce Stock Floor
    SELECT current_stock INTO v_prev_stock
    FROM public.product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product variant with ID % not found', p_variant_id;
    END IF;

    v_new_stock := v_prev_stock + v_effective_change_qty;

    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stock cannot go below 0. Current stock is %, requested change is %', 
            v_prev_stock, v_effective_change_qty;
    END IF;

    -- 6. Apply Atomic Stock Update
    UPDATE public.product_variants
    SET current_stock = v_new_stock,
        last_verified_at = now(),
        updated_at = now()
    WHERE id = p_variant_id;

    -- 7. Record the Movement Audit Row Using Verified Identity
    IF p_reason = 'undo' THEN
        INSERT INTO public.inventory_movements (
            variant_id,
            change_qty,
            previous_stock,
            new_stock,
            reason,
            notes,
            performed_by,
            performed_by_user_id,
            original_movement_id
        ) VALUES (
            p_variant_id,
            v_effective_change_qty,
            v_prev_stock,
            v_new_stock,
            'undo',
            COALESCE(p_notes, 'Undo of movement ' || v_orig.id),
            v_performer_name,
            auth.uid(),
            v_orig.id
        ) RETURNING id INTO v_movement_id;

        -- Mark original movement as undone
        UPDATE public.inventory_movements
        SET is_undone = true,
            undone_at = now()
        WHERE id = v_orig.id;
    ELSE
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
            v_effective_change_qty,
            v_prev_stock,
            v_new_stock,
            p_reason,
            p_notes,
            v_performer_name,
            auth.uid()
        ) RETURNING id INTO v_movement_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'variant_id', p_variant_id,
        'previous_stock', v_prev_stock,
        'new_stock', v_new_stock,
        'movement_id', v_movement_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 3. Permissions (Full 5-Argument Signature)
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.execute_stock_movement(UUID, INT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_stock_movement(UUID, INT, TEXT, TEXT, UUID) TO authenticated;
