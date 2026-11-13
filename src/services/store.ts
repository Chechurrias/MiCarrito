import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

import { PRODUCTS, type Product } from '@/data/products';

const ADMIN_USERNAME = 'ADMIN';
const INITIAL_ADMIN_PASSWORD = '123';
const PASSWORD_HASH_ITERATIONS = 120_000;

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

export type Order = {
  id: string;
  createdAt: string;
  items: CartItem[];
  total: number;
};

type CartRow = { product_id: string; quantity: number };
type OrderRow = { id: string; created_at: string; items: string; total: number };
type UserRow = { password_hash: string; salt: string };

function formatOrder(row: OrderRow): Order {
  return {
    id: row.id,
    createdAt: row.created_at,
    items: JSON.parse(row.items) as CartItem[],
    total: row.total,
  };
}

async function hashPassword(password: string, salt: Uint8Array) {
  const hash = await pbkdf2Async(sha256, utf8ToBytes(password), salt, {
    c: PASSWORD_HASH_ITERATIONS,
    dkLen: 32,
  });
  return bytesToHex(hash);
}

function hashesMatch(first: string, second: string) {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

export async function openStore() {
  const database = await SQLite.openDatabaseAsync('noma.db');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cart (
      product_id TEXT PRIMARY KEY,
      quantity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      items TEXT NOT NULL,
      total INTEGER NOT NULL
    );
  `);
  const admin = await database.getFirstAsync<{ username: string }>(
    'SELECT username FROM users WHERE username = ?',
    ADMIN_USERNAME,
  );
  if (!admin) {
    const salt = await Crypto.getRandomBytesAsync(16);
    await database.runAsync(
      'INSERT OR IGNORE INTO users (username, password_hash, salt) VALUES (?, ?, ?)',
      ADMIN_USERNAME,
      await hashPassword(INITIAL_ADMIN_PASSWORD, salt),
      bytesToHex(salt),
    );
  }
  return database;
}

export async function authenticateAdmin(
  database: SQLite.SQLiteDatabase,
  username: string,
  password: string,
) {
  if (username.trim().toUpperCase() !== ADMIN_USERNAME || !password) return false;
  const user = await database.getFirstAsync<UserRow>(
    'SELECT password_hash, salt FROM users WHERE username = ?',
    ADMIN_USERNAME,
  );
  if (!user) return false;
  const passwordHash = await hashPassword(password, hexToBytes(user.salt));
  return hashesMatch(passwordHash, user.password_hash);
}

export async function getCart(database: SQLite.SQLiteDatabase, products: Product[] = PRODUCTS) {
  const rows = await database.getAllAsync<CartRow>('SELECT * FROM cart');
  return rows.flatMap((row) => {
    const product = products.find((item) => item.id === row.product_id);
    return product
      ? [{ productId: product.id, name: product.name, price: product.price, quantity: row.quantity }]
      : [];
  });
}

export function changeQuantity(database: SQLite.SQLiteDatabase, productId: string) {
  return database.runAsync(
    `INSERT INTO cart VALUES (?, 1)
     ON CONFLICT(product_id) DO UPDATE SET quantity = quantity + 1`,
    productId,
  );
}

export async function removeOne(database: SQLite.SQLiteDatabase, productId: string) {
  const row = await database.getFirstAsync<CartRow>(
    'SELECT * FROM cart WHERE product_id = ?',
    productId,
  );
  if (row?.quantity === 1) {
    await database.runAsync('DELETE FROM cart WHERE product_id = ?', productId);
  } else {
    await database.runAsync(
      'UPDATE cart SET quantity = quantity - 1 WHERE product_id = ?',
      productId,
    );
  }
}

export async function createOrder(database: SQLite.SQLiteDatabase, items: CartItem[]) {
  const order: Order = {
    id: `NOMA-${Date.now()}`,
    createdAt: new Date().toISOString(),
    items,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  };
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'INSERT INTO orders (id, created_at, items, total) VALUES (?, ?, ?, ?)',
      order.id,
      order.createdAt,
      JSON.stringify(items),
      order.total,
    );
    await database.runAsync('DELETE FROM cart');
  });
  return order;
}

export async function getPendingOrders(database: SQLite.SQLiteDatabase) {
  const rows = await database.getAllAsync<OrderRow>('SELECT * FROM orders');
  return rows.map(formatOrder);
}

export function removePendingOrder(database: SQLite.SQLiteDatabase, id: string) {
  return database.runAsync('DELETE FROM orders WHERE id = ?', id);
}
