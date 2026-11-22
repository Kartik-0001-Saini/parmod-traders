-- ==============================================================================
-- Migration 012: Read bills in the app → review → add to stock
-- Parmod Traders Smart Inventory
--
-- 1. bill_lines keeps what the bill reader found (flags, auto-fixes, unit, taxable
--    value); quantity may be empty until the owner fills it in the review screen.
-- 2. save_bill_reading(): step "Saving to database" — replaces the bill's lines with
--    the reader's result, fills the bill header, status → 'extracted'. Stops with a
--    clear message if the same bill (IRN, or supplier GSTIN + invoice no.) was saved before.
-- 3. confirm_purchase_bill(): the owner's "Add to stock" — ALL OR NOTHING:
--    creates new products, adds stock (inventory_movements reason 'purchase_bill'),
--    updates purchase prices incl. and excl. tax (+ price_history), remembers which
--    product each supplier description means (supplier_item_aliases), remembers the
--    supplier, marks the bill 'confirmed'. Errors start with "LINE n:" when they are
--    about one line, so the review screen can highlight that line.
--
-- Safe to run more than once.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. bill_lines: reader output
-- ------------------------------------------------------------------------------
ALTER TABLE public.bill_lines ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE public.bill_lines ALTER COLUMN quantity DROP DEFAULT;
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS taxable_value NUMERIC(12,2);
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS amount_includes_tax BOOLEAN;
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS flags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.bill_lines ADD COLUMN IF NOT EXISTS auto_fixed TEXT[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------------------------
-- 2. save_bill_reading
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_bill_reading(
    p_bill_id UUID,
    p_header JSONB,
    p_lines JSONB,
    p_extracted JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bill RECORD;
    v_dup RECORD;
    v_line JSONB;
    v_count INT := 0;
    v_irn TEXT := NULLIF(trim(p_header->>'irn'), '');
    v_gstin TEXT := NULLIF(upper(trim(p_header->>'supplier_gstin')), '');
    v_invoice TEXT := NULLIF(trim(p_header->>'invoice_number'), '');
    v_qty NUMERIC;
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'Access Denied: Only the Owner can save bill readings.';
    END IF;

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND: This bill no longer exists.';
    END IF;
    IF v_bill.status = 'confirmed' THEN
        RAISE EXCEPTION 'ALREADY_CONFIRMED: This bill was already added to stock.';
    END IF;

    -- The same bill saved before?
    IF v_irn IS NOT NULL THEN
        SELECT id, invoice_number, created_at INTO v_dup
        FROM public.bills WHERE irn = v_irn AND id <> p_bill_id LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION 'DUPLICATE_BILL: This e-invoice is already saved (invoice %, uploaded %).',
                COALESCE(v_dup.invoice_number, '?'), to_char(v_dup.created_at, 'DD Mon YYYY');
        END IF;
    END IF;
    IF v_gstin IS NOT NULL AND v_invoice IS NOT NULL THEN
        SELECT id, created_at INTO v_dup
        FROM public.bills
        WHERE lower(trim(supplier_gstin)) = lower(v_gstin)
          AND lower(trim(invoice_number)) = lower(v_invoice)
          AND id <> p_bill_id
        LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION 'DUPLICATE_BILL: Invoice % from this supplier is already saved (uploaded %).',
                v_invoice, to_char(v_dup.created_at, 'DD Mon YYYY');
        END IF;
    END IF;

    -- Replace the lines (reading a bill again overwrites the previous reading).
    DELETE FROM public.bill_lines WHERE bill_id = p_bill_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
        v_count := v_count + 1;
        v_qty := NULLIF(v_line->>'quantity', '')::NUMERIC;
        INSERT INTO public.bill_lines (
            bill_id, line_number, raw_description, category, brand, size_spec, model_candidate,
            hsn_code, quantity, unit, rate_incl_tax, rate_excl_tax, line_amount, taxable_value,
            amount_includes_tax, gst_rate, is_uncertain, uncertain_fields, flags, auto_fixed
        ) VALUES (
            p_bill_id,
            COALESCE(NULLIF(v_line->>'line_number', '')::INT, v_count),
            COALESCE(v_line->>'raw_description', ''),
            NULLIF(v_line->>'category', ''),
            NULLIF(v_line->>'brand', ''),
            NULLIF(v_line->>'size_spec', ''),
            NULLIF(v_line->>'model_candidate', ''),
            NULLIF(v_line->>'hsn_code', ''),
            CASE WHEN v_qty > 0 THEN round(v_qty)::INT END,
            NULLIF(v_line->>'unit', ''),
            NULLIF(v_line->>'rate_incl_tax', '')::NUMERIC,
            NULLIF(v_line->>'rate_excl_tax', '')::NUMERIC,
            NULLIF(v_line->>'line_amount', '')::NUMERIC,
            NULLIF(v_line->>'taxable_value', '')::NUMERIC,
            NULLIF(v_line->>'amount_includes_tax', '')::BOOLEAN,
            NULLIF(v_line->>'gst_rate', '')::NUMERIC,
            COALESCE((v_line->>'is_uncertain')::BOOLEAN, false),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_line->'uncertain_fields', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_line->'flags', '[]'::jsonb))),
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_line->'auto_fixed', '[]'::jsonb)))
        );
    END LOOP;

    BEGIN
        UPDATE public.bills SET
            supplier_name = COALESCE(NULLIF(trim(p_header->>'supplier_name'), ''), supplier_name),
            supplier_gstin = COALESCE(v_gstin, supplier_gstin),
            invoice_number = COALESCE(v_invoice, invoice_number),
            invoice_date = COALESCE(NULLIF(p_header->>'invoice_date', '')::DATE, invoice_date),
            irn = COALESCE(v_irn, irn),
            subtotal_excl_tax = NULLIF(p_header->>'subtotal', '')::NUMERIC,
            cgst_amount = NULLIF(p_header->>'cgst', '')::NUMERIC,
            sgst_amount = NULLIF(p_header->>'sgst', '')::NUMERIC,
            igst_amount = NULLIF(p_header->>'igst', '')::NUMERIC,
            total_pieces = NULLIF(p_header->>'total_pieces', '')::INT,
            total_amount = COALESCE(NULLIF(p_header->>'grand_total', '')::NUMERIC, total_amount),
            has_continuation_warning = COALESCE((p_header->>'continued')::BOOLEAN, false),
            extracted_data = p_extracted,
            status = 'extracted',
            updated_at = now()
        WHERE id = p_bill_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'DUPLICATE_BILL: A bill with invoice number % from this supplier is already saved.',
            COALESCE(v_invoice, '?');
    END;

    RETURN jsonb_build_object('success', true, 'lines', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.save_bill_reading(UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bill_reading(UUID, JSONB, JSONB, JSONB) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. confirm_purchase_bill (all or nothing)
--
-- p_header: { supplier_name, supplier_gstin, invoice_number, invoice_date }
-- p_lines:  [{ line_id?, line_number, description, hsn_code, quantity,
--              rate_incl_tax, rate_excl_tax, gst_rate, line_amount, match_type,
--              variant_id?  — an existing product
--              new_product? — { category_id, brand, name, variant_name, model_number,
--                               hsn_code, selling_price, mrp, attributes } }]
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_purchase_bill(
    p_bill_id UUID,
    p_header JSONB,
    p_lines JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bill RECORD;
    v_line JSONB;
    v_np JSONB;
    v_idx INT := 0;
    v_no INT;
    v_qty_num NUMERIC;
    v_qty INT;
    v_variant UUID;
    v_product UUID;
    v_existing UUID;
    v_prev INT;
    v_new INT;
    v_incl NUMERIC;
    v_excl NUMERIC;
    v_price NUMERIC;
    v_old_cost NUMERIC;
    v_old_cost_excl NUMERIC;
    v_selling NUMERIC;
    v_mrp NUMERIC;
    v_desc TEXT;
    v_name TEXT := NULLIF(trim(p_header->>'supplier_name'), '');
    v_gstin TEXT := NULLIF(upper(trim(p_header->>'supplier_gstin')), '');
    v_invoice TEXT := NULLIF(trim(p_header->>'invoice_number'), '');
    v_performer TEXT;
    v_pieces INT := 0;
    v_new_products INT := 0;
    v_kept UUID[] := '{}';
BEGIN
    IF NOT public.is_owner() THEN
        RAISE EXCEPTION 'Access Denied: Only the Owner can add a bill to stock.';
    END IF;

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BILL_NOT_FOUND: This bill no longer exists.';
    END IF;
    IF v_bill.status = 'confirmed' THEN
        RAISE EXCEPTION 'ALREADY_CONFIRMED: This bill was already added to stock on %.',
            to_char(v_bill.confirmed_at, 'DD Mon YYYY');
    END IF;
    IF jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'NO_LINES: There are no items to add.';
    END IF;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'SUPPLIER_MISSING: Enter the supplier name.';
    END IF;

    SELECT COALESCE(full_name, email, 'Owner') INTO v_performer FROM public.profiles WHERE id = auth.uid();

    -- Remember the supplier (recognised automatically on the next bill).
    IF v_gstin IS NOT NULL THEN
        INSERT INTO public.suppliers (name, gstin) VALUES (v_name, v_gstin)
        ON CONFLICT (gstin) DO UPDATE SET name = EXCLUDED.name, updated_at = now();
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        v_idx := v_idx + 1;
        v_no := COALESCE(NULLIF(v_line->>'line_number', '')::INT, v_idx);
        v_qty_num := NULLIF(v_line->>'quantity', '')::NUMERIC;
        IF v_qty_num IS NULL OR v_qty_num <= 0 THEN
            RAISE EXCEPTION 'LINE %: Quantity is missing.', v_no;
        END IF;
        IF v_qty_num <> trunc(v_qty_num) THEN
            RAISE EXCEPTION 'LINE %: Quantity must be a whole number of pieces.', v_no;
        END IF;
        v_qty := v_qty_num::INT;
        v_incl := NULLIF(v_line->>'rate_incl_tax', '')::NUMERIC;
        v_excl := NULLIF(v_line->>'rate_excl_tax', '')::NUMERIC;
        v_desc := COALESCE(v_line->>'description', '');
        v_np := v_line->'new_product';
        v_variant := NULLIF(v_line->>'variant_id', '')::UUID;

        IF v_variant IS NULL AND (v_np IS NULL OR jsonb_typeof(v_np) <> 'object') THEN
            RAISE EXCEPTION 'LINE %: Choose the product, or create a new one.', v_no;
        END IF;

        -- New product, created right here (so a failure later undoes it too).
        IF v_variant IS NULL THEN
            IF NULLIF(trim(v_np->>'model_number'), '') IS NULL THEN
                RAISE EXCEPTION 'LINE %: The new product needs a model number.', v_no;
            END IF;
            IF NULLIF(trim(v_np->>'brand'), '') IS NULL OR NULLIF(trim(v_np->>'name'), '') IS NULL THEN
                RAISE EXCEPTION 'LINE %: The new product needs a brand and a name.', v_no;
            END IF;
            IF NULLIF(v_np->>'category_id', '') IS NULL THEN
                RAISE EXCEPTION 'LINE %: Choose a category for the new product.', v_no;
            END IF;
            v_selling := NULLIF(v_np->>'selling_price', '')::NUMERIC;
            v_mrp := COALESCE(NULLIF(v_np->>'mrp', '')::NUMERIC, v_selling);
            IF v_selling IS NULL OR v_selling <= 0 THEN
                RAISE EXCEPTION 'LINE %: The new product needs a selling price.', v_no;
            END IF;

            SELECT id INTO v_existing FROM public.product_variants
            WHERE lower(trim(model_number)) = lower(trim(v_np->>'model_number')) LIMIT 1;
            IF v_existing IS NOT NULL THEN
                RAISE EXCEPTION 'LINE %: Model number "%" already exists — choose that product instead.',
                    v_no, trim(v_np->>'model_number');
            END IF;

            v_product := NULL;
            SELECT id INTO v_product FROM public.products
            WHERE category_id = (v_np->>'category_id')::UUID
              AND lower(trim(brand)) = lower(trim(v_np->>'brand'))
              AND lower(trim(name)) = lower(trim(v_np->>'name'))
            LIMIT 1;
            IF v_product IS NULL THEN
                INSERT INTO public.products (category_id, brand, name, is_active)
                VALUES ((v_np->>'category_id')::UUID, trim(v_np->>'brand'), trim(v_np->>'name'), true)
                RETURNING id INTO v_product;
            END IF;

            INSERT INTO public.product_variants (
                product_id, variant_name, model_number, hsn_code, attributes, current_stock,
                low_stock_threshold, selling_price, mrp, last_verified_at, is_active, is_test_seed
            ) VALUES (
                v_product,
                COALESCE(NULLIF(trim(v_np->>'variant_name'), ''), trim(v_np->>'model_number')),
                trim(v_np->>'model_number'),
                COALESCE(NULLIF(trim(v_np->>'hsn_code'), ''), NULLIF(trim(v_line->>'hsn_code'), ''), '8450'),
                COALESCE(v_np->'attributes', '{}'::jsonb),
                0, 2, v_selling, GREATEST(v_mrp, 0), now(), true, false
            ) RETURNING id INTO v_variant;
            v_new_products := v_new_products + 1;
        END IF;

        -- Add the stock.
        SELECT current_stock INTO v_prev FROM public.product_variants WHERE id = v_variant FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'LINE %: The chosen product no longer exists.', v_no;
        END IF;
        v_new := v_prev + v_qty;
        UPDATE public.product_variants
        SET current_stock = v_new, last_verified_at = now(), updated_at = now()
        WHERE id = v_variant;

        INSERT INTO public.inventory_movements (
            variant_id, change_qty, previous_stock, new_stock, reason, notes,
            performed_by, performed_by_user_id, bill_id
        ) VALUES (
            v_variant, v_qty, v_prev, v_new, 'purchase_bill',
            format('Bill %s from %s, line %s', COALESCE(v_invoice, v_bill.invoice_number, '?'), v_name, v_no),
            COALESCE(v_performer, 'Owner'), auth.uid(), p_bill_id
        );

        -- Purchase price: incl. tax (what the shop pays) and excl. tax.
        v_price := COALESCE(v_incl, v_excl);
        IF v_price IS NOT NULL AND v_price >= 0 THEN
            v_old_cost := NULL;
            v_old_cost_excl := NULL;
            SELECT purchase_price, purchase_price_excl_tax INTO v_old_cost, v_old_cost_excl
            FROM public.product_costs WHERE variant_id = v_variant;

            INSERT INTO public.product_costs (variant_id, purchase_price, purchase_price_excl_tax)
            VALUES (v_variant, v_price, v_excl)
            ON CONFLICT (variant_id) DO UPDATE
            SET purchase_price = EXCLUDED.purchase_price,
                purchase_price_excl_tax = EXCLUDED.purchase_price_excl_tax,
                updated_at = now();

            IF v_old_cost IS DISTINCT FROM v_price OR v_old_cost_excl IS DISTINCT FROM v_excl THEN
                INSERT INTO public.price_history (
                    variant_id, price_type, old_price, new_price, old_price_excl_tax, new_price_excl_tax,
                    change_reason, bill_id, changed_by
                ) VALUES (
                    v_variant, 'purchase', v_old_cost, v_price, v_old_cost_excl, v_excl,
                    'purchase_bill', p_bill_id, COALESCE(v_performer, 'Owner')
                );
            END IF;
        END IF;

        -- Remember what this supplier calls the product.
        IF v_gstin IS NOT NULL AND trim(v_desc) <> '' THEN
            INSERT INTO public.supplier_item_aliases (supplier_gstin, raw_description, clean_description, variant_id, created_by)
            VALUES (v_gstin, v_desc, lower(regexp_replace(trim(v_desc), '\s+', ' ', 'g')), v_variant, auth.uid())
            ON CONFLICT (supplier_gstin, clean_description) DO UPDATE
            SET variant_id = EXCLUDED.variant_id, raw_description = EXCLUDED.raw_description, updated_at = now();
        END IF;

        -- Keep the reviewed line (update the read line, or add it if it was added in the review).
        v_existing := NULL;
        IF NULLIF(v_line->>'line_id', '') IS NOT NULL THEN
            UPDATE public.bill_lines SET
                line_number = v_no,
                raw_description = v_desc,
                hsn_code = NULLIF(trim(v_line->>'hsn_code'), ''),
                quantity = v_qty,
                rate_incl_tax = v_incl,
                rate_excl_tax = v_excl,
                gst_rate = NULLIF(v_line->>'gst_rate', '')::NUMERIC,
                line_amount = NULLIF(v_line->>'line_amount', '')::NUMERIC,
                matched_variant_id = v_variant,
                match_type = COALESCE(NULLIF(v_line->>'match_type', ''), CASE WHEN v_np IS NOT NULL THEN 'new_product' ELSE 'manual' END),
                is_uncertain = false
            WHERE id = (v_line->>'line_id')::UUID AND bill_id = p_bill_id
            RETURNING id INTO v_existing;
        END IF;
        IF v_existing IS NULL THEN
            INSERT INTO public.bill_lines (
                bill_id, line_number, raw_description, hsn_code, quantity, rate_incl_tax, rate_excl_tax,
                gst_rate, line_amount, matched_variant_id, match_type
            ) VALUES (
                p_bill_id, v_no, v_desc, NULLIF(trim(v_line->>'hsn_code'), ''), v_qty, v_incl, v_excl,
                NULLIF(v_line->>'gst_rate', '')::NUMERIC, NULLIF(v_line->>'line_amount', '')::NUMERIC,
                v_variant, CASE WHEN v_np IS NOT NULL THEN 'new_product' ELSE 'manual' END
            ) RETURNING id INTO v_existing;
        END IF;
        v_kept := array_append(v_kept, v_existing);
        v_pieces := v_pieces + v_qty;
    END LOOP;

    -- Lines the owner removed in the review (e.g. a misread row) are dropped.
    DELETE FROM public.bill_lines WHERE bill_id = p_bill_id AND NOT (id = ANY (v_kept));

    BEGIN
        UPDATE public.bills SET
            status = 'confirmed',
            confirmed_at = now(),
            confirmed_by = auth.uid(),
            supplier_name = v_name,
            supplier_gstin = COALESCE(v_gstin, supplier_gstin),
            invoice_number = COALESCE(v_invoice, invoice_number),
            invoice_date = COALESCE(NULLIF(p_header->>'invoice_date', '')::DATE, invoice_date),
            total_pieces = v_pieces,
            updated_at = now()
        WHERE id = p_bill_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'DUPLICATE_BILL: Invoice % from this supplier is already saved.', COALESCE(v_invoice, '?');
    END;

    RETURN jsonb_build_object(
        'success', true,
        'lines', v_idx,
        'pieces', v_pieces,
        'new_products', v_new_products
    );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_purchase_bill(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_bill(UUID, JSONB, JSONB) TO authenticated;

COMMIT;
