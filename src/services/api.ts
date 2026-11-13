import type { Product } from '@/data/products';
import type { Order } from '@/services/store';

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

export async function getCatalog(): Promise<Product[]> {
  const response = await fetch(`${API_URL}/api/products`);
  if (!response.ok) throw await responseError(response, 'No se pudo actualizar el catálogo');
  const products = (await response.json()) as {
    id: string;
    name: string;
    price: number;
    image_url: string;
  }[];
  return products.map(({ id, name, price, image_url }) => ({
    id,
    name,
    price,
    imageUrl: image_url,
  }));
}

export async function sendOrder(order: Order) {
  const response = await fetch(`${API_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(order),
  });
  if (!response.ok) {
    throw await responseError(response, 'La compra se sincronizará cuando vuelva la conexión');
  }
  const savedOrder = (await response.json()) as Pick<Order, 'id' | 'total' | 'items'>;
  return { ...order, ...savedOrder };
}
