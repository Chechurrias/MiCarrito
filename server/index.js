const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { randomUUID, timingSafeEqual } = require('node:crypto');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const LEGACY_PRODUCT_ID_ALIASES = new Map([['camiseta-esencial', 'p1']]);

const app = express();
const database =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : null;

app.use(cors());
app.use(express.json());

app.get('/health', (_request, response) => {
  return response.json({ status: 'ok' });
});

app.get('/api/products', async (_request, response) => {
  if (!database) {
    return response.status(503).json({ error: 'Configura Supabase en server/.env.' });
  }

  const { data, error } = await database
    .from('products_with_inventory')
    .select('id, name, price, image_url, stock')
    .order('id');

  if (error) {
    console.error('Error al consultar productos en Supabase:', error);
    return response.status(500).json({ error: error.message });
  }
  return response.json(data);
});

function requireAdmin(request, response, next) {
  const expectedUsername = process.env.ADMIN_USERNAME || 'ADMIN';
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword) {
    return response.status(503).json({
      error: 'ADMIN_PASSWORD no está cargada en la API. Configúrala en server/.env o en el entorno de Render y reinicia/re-despliega el servidor.',
    });
  }

  const username = request.get('x-admin-username') || '';
  const password = request.get('x-admin-password') || '';
  const passwordBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expectedPassword);
  const passwordMatches =
    passwordBuffer.length === expectedBuffer.length &&
    timingSafeEqual(passwordBuffer, expectedBuffer);

  if (username.toUpperCase() !== expectedUsername.toUpperCase() || !passwordMatches) {
    return response.status(401).json({ error: 'Credenciales ADMIN inválidas.' });
  }
  return next();
}

function parseProductInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl.trim() : '';

  if (!name || name.length > 200) {
    return { error: 'El nombre debe tener entre 1 y 200 caracteres.' };
  }
  if (!Number.isInteger(body.price) || body.price < 1 || body.price > 2147483647) {
    return { error: 'El precio debe ser un entero positivo.' };
  }
  let parsedImageUrl;
  try {
    parsedImageUrl = new URL(imageUrl);
  } catch {
    return { error: 'La imagen debe tener una URL HTTP o HTTPS válida.' };
  }
  if (!['http:', 'https:'].includes(parsedImageUrl.protocol)) {
    return { error: 'La imagen debe tener una URL HTTP o HTTPS válida.' };
  }
  if (!Number.isInteger(body.stock) || body.stock < 0 || body.stock > 2147483647) {
    return { error: 'El stock debe ser un entero igual o mayor que cero.' };
  }
  return { product: { name, price: body.price, imageUrl, stock: body.stock } };
}

async function saveProduct(request, response, productId) {
  if (!database) {
    response.status(503).json({ error: 'Configura Supabase en server/.env.' });
    return null;
  }
  const parsed = parseProductInput(request.body || {});
  if (parsed.error) {
    response.status(400).json({ error: parsed.error });
    return null;
  }

  const { product } = parsed;
  const { data, error } = await database.rpc('admin_save_product', {
    p_id: productId,
    p_name: product.name,
    p_price: product.price,
    p_image_url: product.imageUrl,
    p_stock: product.stock,
  });
  if (error || !data) {
    console.error('Error al guardar producto en Supabase:', error);
    response.status(500).json({ error: error?.message ?? 'Supabase no confirmó el producto.' });
    return null;
  }
  return data;
}

app.post('/api/admin/products', requireAdmin, async (request, response) => {
  try {
    const result = await saveProduct(request, response, randomUUID());
    if (result) return response.status(201).json(result);
  } catch (error) {
    console.error('Error al crear producto en Supabase:', error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido creando el producto.',
    });
  }
});

app.put('/api/admin/products/:id', requireAdmin, async (request, response) => {
  try {
    const result = await saveProduct(request, response, request.params.id);
    if (result) return response.json(result);
    return undefined;
  } catch (error) {
    console.error('Error al actualizar producto en Supabase:', error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido actualizando el producto.',
    });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, async (request, response) => {
  if (!database) {
    return response.status(503).json({ error: 'Configura Supabase en server/.env.' });
  }
  try {
    const { data, error } = await database
      .from('products')
      .delete()
      .eq('id', request.params.id)
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23503') {
        return response.status(409).json({
          error: 'No se puede eliminar el producto porque tiene movimientos de inventario asociados.',
        });
      }
      console.error('Error al eliminar producto en Supabase:', error);
      return response.status(500).json({ error: error.message });
    }
    if (!data) return response.status(404).json({ error: 'No se encontró el producto.' });
    return response.json({ id: data.id });
  } catch (error) {
    console.error('Error al eliminar producto en Supabase:', error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido eliminando el producto.',
    });
  }
});

app.post('/api/orders', async (request, response) => {
  if (!database) {
    return response.status(503).json({ error: 'Configura Supabase en server/.env.' });
  }

  const body = request.body || {};
  const id = body.id;
  const createdAt = body.created_at ?? body.createdAt;
  const rawItems = body.items;

  if (typeof id !== 'string' || !id) {
    return response.status(400).json({ error: 'El campo id es obligatorio.' });
  }

  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    return response.status(400).json({ error: 'El campo created_at no es válido.' });
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return response.status(400).json({ error: `La factura ${id} no contiene artículos.` });
  }

  let items = rawItems.map((item) => {
    if (Array.isArray(item) && item.length === 4) {
      return {
        productId: item[0],
        quantity: item[3],
      };
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return {
        productId: item.productId,
        quantity: item.quantity,
      };
    }
    return null;
  });

  if (
    items.some(
      (item) =>
        !item ||
        typeof item.productId !== 'string' ||
        !item.productId ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return response.status(400).json({ error: 'La factura contiene artículos inválidos.' });
  }

  try {
    const legacyProductIds = [...new Set(
      items
        .map((item) => item.productId)
        .filter((productId) => LEGACY_PRODUCT_ID_ALIASES.has(productId)),
    )];
    if (legacyProductIds.length > 0) {
      const { data: existingProducts, error: productLookupError } = await database
        .from('products')
        .select('id')
        .in('id', legacyProductIds);
      if (productLookupError) {
        console.error('Error al resolver productos heredados en Supabase:', productLookupError);
        return response.status(500).json({ error: productLookupError.message });
      }

      const existingProductIds = new Set(existingProducts.map((product) => product.id));
      items = items.map((item) =>
        existingProductIds.has(item.productId)
          ? item
          : { ...item, productId: LEGACY_PRODUCT_ID_ALIASES.get(item.productId) },
      );
    }

    const orderCreatedAt = new Date(createdAt).toISOString();
    const { data: savedOrder, error } = await database.rpc('create_order_with_stock', {
      p_id: id,
      p_created_at: orderCreatedAt,
      p_items: items,
    });

    if (error || !savedOrder) {
      const databaseMessage = error?.message ?? 'Supabase no confirmó la venta.';
      const stockError = databaseMessage.match(/^INSUFFICIENT_STOCK\|([^|]+)\|(\d+)\|(\d+)$/);
      if (stockError) {
        const [, productId, available, requested] = stockError;
        const { data: product } = await database
          .from('products')
          .select('name')
          .eq('id', productId)
          .maybeSingle();
        const message = `Stock insuficiente para ${product?.name ?? productId}: disponibles ${available}, solicitadas ${requested}. La venta sigue pendiente de validación.`;
        console.warn(`Factura ${id} pendiente por falta de stock.`);
        return response.status(409).json({ error: message });
      }

      const status = error?.code === 'P0001' ? 409 : 500;
      console.error(`Error al guardar la factura ${id}:`, error || databaseMessage);
      return response.status(status).json({ error: databaseMessage });
    }

    console.info(`Factura ${savedOrder.id} confirmada; inventario actualizado en Supabase.`);
    return response.json({
      id: savedOrder.id,
      total: savedOrder.total,
      items: savedOrder.items,
      createdAt: savedOrder.created_at,
    });
  } catch (error) {
    console.error(`Error al procesar la factura ${id}:`, error);
    return response.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido procesando la venta.',
    });
  }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('Servicio de tienda listo en el puerto ' + (process.env.PORT || 3000));
});
