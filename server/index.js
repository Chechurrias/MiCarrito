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
const authClient =
  process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
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

async function requireUser(request, response, next) {
  if (!authClient || !database) {
    return response.status(503).json({ error: 'Supabase no está configurado en el servicio.' });
  }

  const authorization = request.get('authorization') || '';
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return response.status(401).json({ error: 'Inicia sesión para registrar una compra.' });
  }

  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) {
    return response.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' });
  }

  request.user = data.user;
  return next();
}

app.get('/api/products', async (_request, response) => {
  if (!database) {
    return response.status(503).json({ error: 'Configura Supabase en server/.env.' });
  }

  const { data, error } = await database
    .from('products')
    .select('id, name, price, image_url')
    .order('id');

  if (error) return response.status(500).json({ error: error.message });
  return response.json(data);
});

app.post('/api/orders', async (request, response) => {
  if (!database) {
    return response.status(503).json({ error: 'Configura Supabase en server/.env.' });
  }

  const body = request.body || {};
  const id = body.id;
  const createdAt = body.createdAt;
  const rawItems = body.items;

  if (typeof id !== 'string' || !id) {
    return response.status(400).json({ error: 'El campo id es obligatorio.' });
  }

  if (typeof createdAt !== 'string' || !createdAt) {
    return response.status(400).json({ error: 'El campo createdAt es obligatorio.' });
  }

  let items = [];
  if (Array.isArray(rawItems)) {
    const pureRows = rawItems.filter((item) => item != null && Array.isArray(item) && item.length >= 3);
    if (pureRows.length > 0) {
      items = pureRows.map((entry) => ({
        productId: String(entry[0]),
        name: String(entry[1]),
        price: Number(entry[2]),
        quantity: Number(entry[3]),
      }));
    } else {
      const values = rawItems.flatMap((entry) => Array.isArray(entry) ? entry : Object.values(entry ?? {}));
      items = values.filter((item) => item != null && Array.isArray(item) && item.length === 4).map((entry) => ({
        productId: String(entry[0]),
        name: String(entry[1]),
        price: Number(entry[2]),
        quantity: Number(entry[3]),
      }));
    }
  } else if (rawItems && typeof rawItems === 'object') {
    const values = Object.values(rawItems).flatMap((entry) => Array.isArray(entry) ? entry : Object.values(entry ?? {}));
    items = values.filter((item) => item != null && Array.isArray(item) && item.length === 4).map((entry) => ({
      productId: String(entry[0]),
      name: String(entry[1]),
      price: Number(entry[2]),
      quantity: Number(entry[3]),
    }));
  }

  if (items.length === 0) {
    return response.status(400).json({ error: 'La compra está vacía.' });
  }

  const parsedItems = items.map((item) => ({
    productId: String(item.productId),
    name: String(item.name),
    price: Number(item.price),
    quantity: Number(item.quantity),
  }));

  if (parsedItems.some((item) => typeof item.productId !== 'string' || !item.productId || Number.isNaN(item.price) || !Number.isInteger(item.quantity) || item.quantity < 1)) {
    return response.status(400).json({ error: 'La compra contiene un producto no válido.' });
  }

  const { data: products, error: catalogError } = await database
    .from('products')
    .select('id, name, price')
    .in('id', parsedItems.map((item) => item.productId));

  if (catalogError) {
    console.error('Error al consultar catálogo:', catalogError);
    return response.status(500).json({ error: 'Error consultando el catálogo.' });
  }

  const savedItems = parsedItems.map((item) => {
    const product = products.find((entry) => entry.id === item.productId);
    if (!product) return null;
    return {
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
    };
  });

  if (savedItems.includes(null)) {
    return response.status(400).json({ error: 'La compra contiene un producto no válido.' });
  }

  const total = savedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  try {
    const orderCreatedAt = new Date(createdAt).toISOString();

    const { error } = await database.from('orders').upsert({
      id,
      total,
      items: savedItems,
      created_at: orderCreatedAt,
    });

    if (error) {
      console.error('Error al guardar orden:', error);
      return response.status(500).json({ error: 'Error guardando la orden.' });
    }

    return response.json({
      id,
      total,
      items: savedItems,
      created_at: orderCreatedAt,
    });
  } catch (error) {
    console.error('Error al guardar orden:', error);
    return response.status(500).json({ error: 'Error guardando la orden.' });
  }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('Servicio de tienda listo en el puerto ' + (process.env.PORT || 3000));
});
