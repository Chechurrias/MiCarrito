const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

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

  const items = rawItems.map((item) => {
    if (Array.isArray(item) && item.length === 4) {
      return { productId: item[0], quantity: item[3] };
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return { productId: item.productId, quantity: item.quantity };
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
