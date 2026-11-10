-- ==============================================================================
-- Migration 002: Seed Data for Testing (Showroom Catalog)
-- ==============================================================================
-- IMPORTANT NOTE: All sample products in this file are marked with:
--   is_test_seed = true
-- This ensures test data is NEVER mixed up with real showroom inventory.
-- You can wipe all seed data at any time by running:
--   DELETE FROM public.product_variants WHERE is_test_seed = true;
-- ==============================================================================

DO $$
DECLARE
    -- Category IDs
    v_cat_wm UUID;
    v_cat_ref UUID;
    v_cat_ac UUID;
    v_cat_tv UUID;
    v_cat_cooler UUID;
    v_cat_other UUID;

    -- Product IDs
    v_prod_godrej_wm UUID;
    v_prod_lg_ref UUID;
    v_prod_voltas_ac UUID;
    v_prod_samsung_tv UUID;
    v_prod_symphony_cooler UUID;
    v_prod_bajaj_mixer UUID;
BEGIN
    -- 1. Insert Categories
    INSERT INTO public.categories (name, name_hi, slug, icon, display_order)
    VALUES ('Washing Machines', 'वॉशिंग मशीन', 'washing-machines', '🧺', 1)
    RETURNING id INTO v_cat_wm;

    INSERT INTO public.categories (name, name_hi, slug, icon, display_order)
    VALUES ('Refrigerators', 'फ्रिज', 'refrigerators', '❄️', 2)
    RETURNING id INTO v_cat_ref;

    INSERT INTO public.categories (name, name_hi, slug, icon, display_order)
    VALUES ('Air Conditioners', 'एसी (AC)', 'air-conditioners', '💨', 3)
    RETURNING id INTO v_cat_ac;

    INSERT INTO public.categories (name, name_hi, slug, icon, display_order)
    VALUES ('LED TVs', 'एलईडी टीवी', 'led-tvs', '📺', 4)
    RETURNING id INTO v_cat_tv;

    INSERT INTO public.categories (name, name_hi, slug, icon, display_order)
    VALUES ('Air Coolers', 'कूलर', 'air-coolers', '🌀', 5)
    RETURNING id INTO v_cat_cooler;

    INSERT INTO public.categories (name, name_hi, slug, icon, display_order)
    VALUES ('Other Electronics', 'अन्य सामान', 'other', '🔌', 6)
    RETURNING id INTO v_cat_other;

    -- 2. Insert Category Attributes (Flexible spec definitions)
    INSERT INTO public.category_attributes (category_id, name, name_hi, attribute_type, options, is_required)
    VALUES
        (v_cat_wm, 'Capacity', 'क्षमता', 'select', '["6 KG", "7 KG", "8 KG", "9 KG"]'::jsonb, true),
        (v_cat_wm, 'Type', 'प्रकार', 'select', '["Front Load", "Top Load", "Semi-Automatic"]'::jsonb, true),
        (v_cat_wm, 'Energy Rating', 'स्टार रेटिंग', 'select', '["5 Star", "4 Star", "3 Star"]'::jsonb, false),
        (v_cat_ref, 'Capacity', 'क्षमता', 'text', null, true),
        (v_cat_ref, 'Door Style', 'दरवाजा', 'select', '["Single Door", "Double Door", "Side-by-Side"]'::jsonb, true),
        (v_cat_ac, 'Tonnage', 'टन', 'select', '["1 Ton", "1.5 Ton", "2 Ton"]'::jsonb, true),
        (v_cat_tv, 'Screen Size', 'स्क्रीन साइज', 'select', '["32 Inch", "43 Inch", "55 Inch", "65 Inch"]'::jsonb, true);

    -- 3. Insert Base Products
    INSERT INTO public.products (category_id, brand, name, description)
    VALUES (v_cat_wm, 'Godrej', 'Front Load Washing Machine', 'Godrej Inverter Front Loading Automatic Washing Machine')
    RETURNING id INTO v_prod_godrej_wm;

    INSERT INTO public.products (category_id, brand, name, description)
    VALUES (v_cat_ref, 'LG', 'Smart Inverter Refrigerator', 'LG Frost-Free Double Door Refrigerator with Smart Inverter Compressor')
    RETURNING id INTO v_prod_lg_ref;

    INSERT INTO public.products (category_id, brand, name, description)
    VALUES (v_cat_ac, 'Voltas', 'Inverter Split AC', 'Voltas Adjustable Inverter Split Air Conditioner with Copper Condenser')
    RETURNING id INTO v_prod_voltas_ac;

    INSERT INTO public.products (category_id, brand, name, description)
    VALUES (v_cat_tv, 'Samsung', 'Crystal 4K UHD Smart TV', 'Samsung Ultra HD 4K Smart Television with Tizen OS')
    RETURNING id INTO v_prod_samsung_tv;

    INSERT INTO public.products (category_id, brand, name, description)
    VALUES (v_cat_cooler, 'Symphony', 'Diet Desert Air Cooler', 'Symphony Personal Tower Cooler with Honeycomb cooling pads')
    RETURNING id INTO v_prod_symphony_cooler;

    INSERT INTO public.products (category_id, brand, name, description)
    VALUES (v_cat_other, 'Bajaj', 'Popular Plus Mixer Grinder', 'Bajaj 500W Mixer Grinder with 3 Stainless Steel Jars')
    RETURNING id INTO v_prod_bajaj_mixer;

    -- 4. Insert Variants (EVERY variant is a separate item with its own stock & model number!)
    -- 4a. Godrej 8 KG Front Load (Stock: 4)
    INSERT INTO public.product_variants (
        product_id, variant_name, model_number, attributes,
        current_stock, low_stock_threshold, selling_price, mrp, latest_purchase_price,
        last_verified_at, is_test_seed
    ) VALUES (
        v_prod_godrej_wm,
        '8 KG Front Load / 5 Star Inverter',
        'WTEON-800-AD',
        '{"Capacity": "8 KG", "Type": "Front Load", "Energy Rating": "5 Star"}'::jsonb,
        4, 2, 28990, 35990, 24500,
        now() - INTERVAL '2 days',
        true
    );

    -- 4b. LG 260 L Double Door Refrigerator (Stock: 2 - Low stock!)
    INSERT INTO public.product_variants (
        product_id, variant_name, model_number, attributes,
        current_stock, low_stock_threshold, selling_price, mrp, latest_purchase_price,
        last_verified_at, is_test_seed
    ) VALUES (
        v_prod_lg_ref,
        '260 Litres Smart Inverter / Shiny Steel',
        'GL-S292RDSY',
        '{"Capacity": "260 L", "Door Style": "Double Door", "Defrosting": "Frost Free"}'::jsonb,
        2, 2, 26490, 31890, 22800,
        now() - INTERVAL '1 day',
        true
    );

    -- 4c. Voltas 1.5 Ton Split AC (Stock: 0 - Out of stock!)
    INSERT INTO public.product_variants (
        product_id, variant_name, model_number, attributes,
        current_stock, low_stock_threshold, selling_price, mrp, latest_purchase_price,
        last_verified_at, is_test_seed
    ) VALUES (
        v_prod_voltas_ac,
        '1.5 Ton 3 Star Copper Condenser',
        '183V-Vectra-Plat',
        '{"Tonnage": "1.5 Ton", "Star Rating": "3 Star", "Condenser": "Copper"}'::jsonb,
        0, 1, 32990, 62990, 28500,
        now() - INTERVAL '9 days', -- Triggers 7+ day verification alert!
        true
    );

    -- 4d. Samsung 55 Inch 4K Smart TV (Stock: 6)
    INSERT INTO public.product_variants (
        product_id, variant_name, model_number, attributes,
        current_stock, low_stock_threshold, selling_price, mrp, latest_purchase_price,
        last_verified_at, is_test_seed
    ) VALUES (
        v_prod_samsung_tv,
        '55 Inch Ultra HD (4K) Smart LED',
        'UA55AUE60AKXXL',
        '{"Screen Size": "55 Inch", "Resolution": "4K UHD", "OS": "Tizen"}'::jsonb,
        6, 2, 42990, 64900, 37200,
        now() - INTERVAL '8 days', -- Triggers 7+ day verification alert!
        true
    );

    -- 4e. Symphony Cooler (Stock: 5)
    INSERT INTO public.product_variants (
        product_id, variant_name, model_number, attributes,
        current_stock, low_stock_threshold, selling_price, mrp, latest_purchase_price,
        last_verified_at, is_test_seed
    ) VALUES (
        v_prod_symphony_cooler,
        '35 Litre Personal Tower Cooler',
        'DIET-3D-30i',
        '{"Tank": "35 Litres", "Pad": "Honeycomb"}'::jsonb,
        5, 2, 8490, 10499, 6900,
        now(),
        true
    );

    -- 4f. Bajaj Mixer Grinder (Stock: 1 - Low stock!)
    INSERT INTO public.product_variants (
        product_id, variant_name, model_number, attributes,
        current_stock, low_stock_threshold, selling_price, mrp, latest_purchase_price,
        last_verified_at, is_test_seed
    ) VALUES (
        v_prod_bajaj_mixer,
        '500 Watt with 3 Stainless Steel Jars',
        'GX-1-POPLR',
        '{"Wattage": "500 W", "Jars": "3 Stainless Steel"}'::jsonb,
        1, 2, 1999, 3200, 1550,
        now() - INTERVAL '3 days',
        true
    );

END $$;
