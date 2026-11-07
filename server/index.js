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

app.post('/api/orders', requireUser, async (request, response) => {
  if (!database) {
    return response.status(503).json({ error: 'Configura Supabase en server/.env.' });
  }

  const { id, createdAt, items } = request.body || {};
  if (
    typeof id !== 'string' ||
    !id ||
    typeof createdAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Array.isArray(items) ||
    items.length === 0 ||
    items.some(
      (item) =>
        !item ||
        typeof item.productId !== 'string' ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return response.status(400).json({ error: 'La compra está vacía.' });
  }

  const { data: products, error: catalogError } = await database
    .from('products')
    .select('id, name, price')
    .in('id', items.map((item) => item.productId));
  if (catalogError) return response.status(500).json({ error: catalogError.message });

  const savedItems = items.map((item) => {
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
  const { error } = await database.from('orders').upsert({
    id,
    total,
    items: savedItems,
    created_at: createdAt,
  });

  if (error) return response.status(500).json({ error: error.message });
  return response.json({ id, total, items: savedItems });
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => {
  console.log('Servicio de tienda listo en el puerto ' + (process.env.PORT || 3000));
});
