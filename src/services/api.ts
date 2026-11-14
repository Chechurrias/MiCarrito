import type { Product } from '@/data/products';
import type { CartItem, Order } from '@/services/store';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

async function responseError(response: Response, fallback: string) {
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

export async function sendOrder(order: Order) {
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw new Error(`La factura ${order.id} no tiene artículos guardados en SQLite.`);
  }

  const payload = {
    id: order.id,
    createdAt: order.createdAt,
    created_at: order.createdAt,
    items: order.items.map(({ productId, name, price, quantity }) => [
      productId,
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
