CREATE TABLE IF NOT EXISTS public.inventory (
  product_id text PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'stock'
  ) THEN
    EXECUTE '
      INSERT INTO public.inventory (product_id, stock)
      SELECT id, stock
      FROM public.products
      ON CONFLICT (product_id) DO NOTHING
    ';
    ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_nonnegative;
    ALTER TABLE public.products DROP COLUMN stock;
  END IF;
END;
$$;

INSERT INTO public.inventory (product_id, stock)
SELECT id, 0
FROM public.products
ON CONFLICT (product_id) DO NOTHING;

CREATE OR REPLACE VIEW public.products_with_inventory AS
SELECT products.id, products.name, products.price, products.image_url, inventory.stock
FROM public.products
JOIN public.inventory ON inventory.product_id = products.id;

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id text NOT NULL REFERENCES public.inventory(product_id),
  order_id text NOT NULL REFERENCES public.orders(id),
  quantity_change integer NOT NULL CHECK (quantity_change <> 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.create_order_with_stock(
  p_id text,
  p_created_at timestamptz,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  existing_order public.orders%ROWTYPE;
  item record;
  v_product_id text;
  v_product_name text;
  v_product_price integer;
  v_inventory_stock integer;
  saved_order jsonb;
  saved_items jsonb := '[]'::jsonb;
  total_amount bigint := 0;
BEGIN
  IF p_id IS NULL OR p_id = '' OR p_created_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ORDER: factura y fecha son obligatorias';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMPTY_ORDER: la venta no contiene artículos';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'EMPTY_ORDER: la venta no contiene artículos';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS entry(value)
    WHERE jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
       OR jsonb_typeof(entry.value -> 'productId') IS DISTINCT FROM 'string'
       OR COALESCE(entry.value ->> 'productId', '') = ''
       OR jsonb_typeof(entry.value -> 'quantity') IS DISTINCT FROM 'number'
       OR COALESCE(entry.value ->> 'quantity', '') !~ '^[1-9][0-9]*$'
       OR CASE
         WHEN jsonb_typeof(entry.value -> 'quantity') = 'number'
           AND COALESCE(entry.value ->> 'quantity', '') ~ '^[1-9][0-9]*$'
         THEN (entry.value ->> 'quantity')::numeric > 2147483647
         ELSE false
       END
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ORDER_ITEM: producto o cantidad inválidos';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_id));

  SELECT *
  INTO existing_order
  FROM public.orders
  WHERE id = p_id
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', existing_order.id,
      'total', existing_order.total,
      'items', existing_order.items,
      'created_at', existing_order.created_at
    );
  END IF;

  FOR item IN
    SELECT input."productId" AS product_id, SUM(input.quantity)::bigint AS quantity
    FROM jsonb_to_recordset(p_items) AS input("productId" text, quantity bigint)
    GROUP BY input."productId"
    ORDER BY input."productId"
  LOOP
    SELECT products.id, products.name, products.price, inventory.stock
    INTO v_product_id, v_product_name, v_product_price, v_inventory_stock
    FROM public.products
    JOIN public.inventory ON inventory.product_id = products.id
    WHERE products.id = item.product_id
    FOR UPDATE OF products, inventory;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = format('PRODUCT_NOT_FOUND|%s', item.product_id);
    END IF;

    IF v_inventory_stock < item.quantity THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = format('INSUFFICIENT_STOCK|%s|%s|%s', v_product_id, v_inventory_stock, item.quantity);
    END IF;

    total_amount := total_amount + (v_product_price::bigint * item.quantity);
    IF total_amount > 2147483647 THEN
      RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'ORDER_TOTAL_OUT_OF_RANGE';
    END IF;

    saved_items := saved_items || jsonb_build_array(
      jsonb_build_object(
        'productId', v_product_id,
        'name', v_product_name,
        'price', v_product_price,
        'quantity', item.quantity
      )
    );

    UPDATE public.inventory
    SET stock = stock - item.quantity::integer
    WHERE inventory.product_id = v_product_id;
  END LOOP;

  INSERT INTO public.orders (id, total, items, created_at)
  VALUES (p_id, total_amount::integer, saved_items, p_created_at)
  RETURNING jsonb_build_object(
    'id', id,
    'total', total,
    'items', items,
    'created_at', created_at
  )
  INTO saved_order;

  INSERT INTO public.inventory_movements (product_id, order_id, quantity_change)
  SELECT movement_item."productId", p_id, -SUM(movement_item.quantity)::integer
  FROM jsonb_to_recordset(p_items) AS movement_item("productId" text, quantity bigint)
  GROUP BY movement_item."productId";

  RETURN saved_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_product(
  p_id text,
  p_name text,
  p_price integer,
  p_image_url text,
  p_stock integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  saved_product jsonb;
BEGIN
  IF p_id IS NULL OR p_id = ''
     OR p_name IS NULL OR btrim(p_name) = ''
     OR length(btrim(p_name)) > 200
     OR p_price IS NULL OR p_price < 1
     OR p_image_url IS NULL OR p_image_url = ''
     OR p_stock IS NULL OR p_stock < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PRODUCT: datos de producto inválidos';
  END IF;

  INSERT INTO public.products (id, name, price, image_url)
  VALUES (p_id, btrim(p_name), p_price, p_image_url)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    price = excluded.price,
    image_url = excluded.image_url;

  INSERT INTO public.inventory (product_id, stock)
  VALUES (p_id, p_stock)
  ON CONFLICT (product_id) DO UPDATE SET
    stock = excluded.stock,
    updated_at = now();

  SELECT jsonb_build_object(
    'id', products.id,
    'name', products.name,
    'price', products.price,
    'image_url', products.image_url,
    'stock', inventory.stock
  )
  INTO saved_product
  FROM public.products
  JOIN public.inventory ON inventory.product_id = products.id
  WHERE products.id = p_id;

  RETURN saved_product;
END;
$$;

REVOKE ALL ON FUNCTION public.create_order_with_stock(text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_stock(text, timestamptz, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.admin_save_product(text, text, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_product(text, text, integer, text, integer) TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.inventory TO service_role;
GRANT SELECT ON public.products_with_inventory TO service_role;
GRANT SELECT, INSERT ON public.orders TO service_role;
GRANT SELECT, INSERT ON public.inventory_movements TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.inventory_movements_id_seq TO service_role;
