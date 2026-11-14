import type { Product } from '@/data/products';
import type { CartItem, Order } from '@/services/store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

const LEGACY_PRODUCT_ID_ALIASES = new Map([['camiseta-esencial', 'p1']]);

export type AdminCredentials = {
  username: string;
  password: string;
};

export type ProductInput = {
  name: string;
  price: number;
  imageUrl: string;
  stock: number;
};

async function responseError(response: Response, fallback: string) {
  if (response.status === 404) {
    return new Error(
      `${fallback} (HTTP 404). La API configurada no tiene esta ruta; verifica EXPO_PUBLIC_API_URL y despliega la versión actual del servidor.`,
    );
  }
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') {
      return new Error(body.error);
    }
  } catch {
    // Use the HTTP status when the server does not return a JSON error.
  }
  return new Error(`${fallback} (HTTP ${response.status}).`);
}

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === 'string' &&
    typeof item.name === 'string' &&
    typeof item.price === 'number' &&
    Number.isFinite(item.price) &&
    typeof item.quantity === 'number' &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0
  );
}

function isSavedOrder(value: unknown, expectedId: string): value is Pick<Order, 'id' | 'total' | 'items'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const order = value as Record<string, unknown>;
  return (
    order.id === expectedId &&
    typeof order.total === 'number' &&
    Number.isFinite(order.total) &&
    Array.isArray(order.items) &&
    order.items.every(isCartItem)
  );
}

export async function getCatalog(): Promise<Product[]> {
  const response = await fetch(`${API_URL}/api/products`);
  if (!response.ok) throw await responseError(response, 'No se pudo actualizar el catálogo');
  const products = (await response.json()) as {
    id: string;
    name: string;
    price: number;
    image_url: string;
    stock: number;
  }[];
  return products.map(({ id, name, price, image_url, stock }) => ({
    id,
    name,
    price,
    imageUrl: image_url,
    stock,
  }));
}

function adminHeaders(credentials: AdminCredentials) {
  return {
    'Content-Type': 'application/json',
    'x-admin-username': credentials.username,
    'x-admin-password': credentials.password,
  };
}

function formatProduct(product: {
  id: string;
  name: string;
  price: number;
  image_url: string;
  stock: number;
}): Product {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    imageUrl: product.image_url,
    stock: product.stock,
  };
}

async function saveProductRequest(
  path: string,
  method: 'POST' | 'PUT',
  input: ProductInput,
  credentials: AdminCredentials,
): Promise<Product> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: adminHeaders(credentials),
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await responseError(response, 'No se pudo guardar el producto');
  const product = (await response.json()) as Parameters<typeof formatProduct>[0];
  return formatProduct(product);
}

export function createProduct(input: ProductInput, credentials: AdminCredentials) {
  return saveProductRequest('/api/admin/products', 'POST', input, credentials);
}

export function updateProduct(
  productId: string,
  input: ProductInput,
  credentials: AdminCredentials,
) {
  return saveProductRequest(
    `/api/admin/products/${encodeURIComponent(productId)}`,
    'PUT',
    input,
    credentials,
  );
}

export async function deleteProduct(productId: string, credentials: AdminCredentials) {
  const response = await fetch(`${API_URL}/api/admin/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
    headers: adminHeaders(credentials),
  });
  if (!response.ok) throw await responseError(response, 'No se pudo eliminar el producto');
}

export async function sendOrder(order: Order) {
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error(`La factura ${order.id} no tiene artículos guardados en SQLite.`);
  }

  const payload = {
    id: order.id,
    createdAt: order.createdAt,
    created_at: order.createdAt,
    items: order.items.map(({ productId, name, price, quantity }) => [
      LEGACY_PRODUCT_ID_ALIASES.get(productId) ?? productId,
      name,
      price,
      quantity,
    ]),
    total: order.total,
  };
  const response = await fetch(`${API_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await responseError(response, 'La compra se sincronizará cuando vuelva la conexión');
  }
  const savedOrder: unknown = await response.json();
  if (!isSavedOrder(savedOrder, order.id)) {
    throw new Error('El servidor no confirmó la factura guardada en Supabase.');
  }
  return { ...order, ...savedOrder };
}
