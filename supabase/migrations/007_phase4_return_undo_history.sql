-- ==============================================================================
-- Migration 007: Phase 4 Return, Hardened Undo & Stock Movement Audit
-- ==============================================================================
-- Purpose:
-- 1. Updates inventory_movements table with original_movement_id, is_undone, undone_at.
-- 2. Expands reason CHECK constraint safely to include 'undo'.
-- 3. Explicitly drops all old overloads of execute_stock_movement using full argument lists.
-- 4. Creates the new function with full signature (UUID, INT, TEXT, TEXT, TEXT, UUID).
-- 5. Hardens all business & security guards inside the database function:
--    - Staff single-piece limit: sale is -1, return is +1.
--    - Undo strictly requires valid original movement ID.
--    - An Undo cannot be undone again (no undo chaining).
--    - An action cannot be undone twice.
--    - Staff can only undo their OWN action (within 10 minutes).
--    - Owner can undo ANY action (within 10 minutes).
--    - Undo quantity is strictly forced to -1 * original_movement.change_qty (cannot spoof quantity).
--    - Stock floor cannot drop below 0 (guarded by FOR UPDATE row lock).
-- 6. Specifies full argument list in all REVOKE and GRANT statements.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Alter inventory_movements Columns & Constraints Safely
-- ------------------------------------------------------------------------------
ALTER TABLE public.inventory_movements
ADD COLUMN IF NOT EXISTS original_movement_id UUID REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_undone BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;

-- Drop old check constraint safely and recreate with 'undo'
ALTER TABLE public.inventory_movements 
DROP CONSTRAINT IF EXISTS inventory_movements_reason_check;

ALTER TABLE public.inventory_movements
ADD CONSTRAINT inventory_movements_reason_check 
CHECK (reason IN ('sale', 'return', 'purchase_bill', 'manual_correction', 'stock_count', 'undo'));

CREATE INDEX IF NOT EXISTS idx_movements_original_id ON public.inventory_movements(original_movement_id);

-- ------------------------------------------------------------------------------
-- 2. Explicitly Drop Old Overloads (Full Signature)
-- ------------------------------------------------------------------------------
-- Drop the 4-argument version currently present in the database:
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT);

-- Drop 5-argument or any previous 6-argument versions to prevent error 42725:
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT, UUID);

-- ------------------------------------------------------------------------------
-- 3. Create the New execute_stock_movement Function (Full 6-Argument Signature)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_stock_movement(
    p_variant_id UUID,
    p_change_qty INT,
    p_reason TEXT,
    p_performed_by TEXT,
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
    v_orig RECORD;
BEGIN
    -- GUARD 1: Authentication Check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Access Denied: You must be logged in to update stock.';
    END IF;

    -- GUARD 2: Role Verification
    SELECT role INTO v_user_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_user_role IS NULL OR v_user_role NOT IN ('owner', 'staff') THEN
        RAISE EXCEPTION 'Access Denied: Your account does not have permission to modify stock.';
    END IF;

    -- GUARD 3: Staff Single-Piece & Action Limits
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

    -- GUARD 4: Strict Undo Verification Logic
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

        -- Staff can only undo their OWN action; Owner can undo anyone's
        IF v_user_role = 'staff' AND v_orig.performed_by_user_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'UNAUTHORIZED_UNDO: Staff accounts can only undo actions they performed themselves.';
        END IF;

        -- Force variant and exact opposite quantity (Staff cannot spoof quantity)
        p_variant_id := v_orig.variant_id;
        v_effective_change_qty := -v_orig.change_qty;
    ELSE
        v_effective_change_qty := p_change_qty;
    END IF;

    -- GUARD 5: Lock Product Variant Row & Verify Stock Floor
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

    -- 7. Record the Movement Audit Row
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
            p_performed_by,
            auth.uid(),
            v_orig.id
        ) RETURNING id INTO v_movement_id;

        -- Mark the original movement as undone
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
            p_performed_by,
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
-- 4. Permissions (Full Signature Required to Prevent Error 42725)
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_stock_movement(UUID, INT, TEXT, TEXT, TEXT, UUID) TO authenticated;
