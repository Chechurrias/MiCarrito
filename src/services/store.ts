import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

import { PRODUCTS, type Product } from '@/data/products';

export const ADMIN_USERNAME = 'ADMIN';
const INITIAL_ADMIN_PASSWORD = '123';
const PASSWORD_HASH_ITERATIONS = 120_000;

export type UserRole = 'ADMIN' | 'CUSTOMER';

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
type InventoryRow = { product_id: string; stock: number };
type ForeignKeyRow = { table: string; from: string; to: string };
type TableColumnRow = { name: string };
type UserRow = { password_hash: string; salt: string; role: UserRole };

function normalizeUsername(username: string) {
  return username.trim().toUpperCase();
}

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
  await database.execAsync('PRAGMA foreign_keys = ON');
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('ADMIN', 'CUSTOMER'))
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
    CREATE TABLE IF NOT EXISTS products_cache (
      id TEXT PRIMARY KEY,
      name TEXT,
      price INTEGER,
      image_url TEXT
    );
    CREATE TABLE IF NOT EXISTS inventory (
      product_id TEXT PRIMARY KEY REFERENCES products_cache(id) ON DELETE CASCADE,
      stock INTEGER NOT NULL CHECK (stock >= 0),
      updated_at TEXT NOT NULL
    );
  `);
  const userColumns = await database.getAllAsync<TableColumnRow>('PRAGMA table_info(users)');
  if (!userColumns.some((column) => column.name === 'role')) {
    await database.execAsync(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'CUSTOMER'",
    );
  }
  await database.runAsync(
    'UPDATE users SET role = ? WHERE UPPER(username) = ?',
    'ADMIN',
    ADMIN_USERNAME,
  );
  for (const product of PRODUCTS) {
    await database.runAsync(
      'INSERT OR IGNORE INTO products_cache (id, name, price, image_url) VALUES (?, ?, ?, ?)',
      product.id,
      product.name,
      product.price,
      product.imageUrl,
    );
  }
  const inventoryForeignKeys =
    await database.getAllAsync<ForeignKeyRow>('PRAGMA foreign_key_list(inventory)');
  if (!inventoryForeignKeys.some((foreignKey) => foreignKey.table === 'products_cache')) {
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        INSERT OR IGNORE INTO products_cache (id)
        SELECT product_id FROM inventory;
        CREATE TABLE inventory_with_product_fk (
          product_id TEXT PRIMARY KEY REFERENCES products_cache(id) ON DELETE CASCADE,
          stock INTEGER NOT NULL CHECK (stock >= 0),
          updated_at TEXT NOT NULL
        );
        INSERT INTO inventory_with_product_fk (product_id, stock, updated_at)
        SELECT product_id, stock, updated_at FROM inventory;
        DROP TABLE inventory;
        ALTER TABLE inventory_with_product_fk RENAME TO inventory;
      `);
    });
  }
  const admin = await database.getFirstAsync<{ username: string }>(
    'SELECT username FROM users WHERE username = ?',
    ADMIN_USERNAME,
  );
  if (!admin) {
    const salt = await Crypto.getRandomBytesAsync(16);
    await database.runAsync(
      'INSERT OR IGNORE INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)',
      ADMIN_USERNAME,
      await hashPassword(INITIAL_ADMIN_PASSWORD, salt),
      bytesToHex(salt),
      'ADMIN',
    );
  }
  return database;
}

export async function authenticateUser(
  database: SQLite.SQLiteDatabase,
  username: string,
  password: string,
): Promise<UserRole | null> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) return null;
  const user = await database.getFirstAsync<UserRow>(
    'SELECT password_hash, salt, role FROM users WHERE username = ?',
    normalizedUsername,
  );
  if (!user) return null;
  const passwordHash = await hashPassword(password, hexToBytes(user.salt));
  return hashesMatch(passwordHash, user.password_hash) ? user.role : null;
}

export async function createCustomerAccount(
  database: SQLite.SQLiteDatabase,
  username: string,
  password: string,
) {
  const normalizedUsername = normalizeUsername(username);
  if (!/^[A-Z0-9._-]{3,24}$/.test(normalizedUsername)) {
    throw new Error('El usuario debe tener entre 3 y 24 caracteres (letras, números, punto, guion o guion bajo).');
  }
  if (normalizedUsername === ADMIN_USERNAME) {
    throw new Error('Ese nombre está reservado.');
  }
  if (password.length < 6) {
    throw new Error('La contraseña debe tener al menos 6 caracteres.');
  }

  const existingUser = await database.getFirstAsync<{ username: string }>(
    'SELECT username FROM users WHERE username = ?',
    normalizedUsername,
  );
  if (existingUser) throw new Error('Ese usuario ya existe en este dispositivo.');

  const salt = await Crypto.getRandomBytesAsync(16);
  await database.runAsync(
    'INSERT INTO users (username, password_hash, salt, role) VALUES (?, ?, ?, ?)',
    normalizedUsername,
    await hashPassword(password, salt),
    bytesToHex(salt),
    'CUSTOMER',
  );
  return normalizedUsername;
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

export async function getProductsWithCachedStock(
  database: SQLite.SQLiteDatabase,
  products: Product[] = PRODUCTS,
) {
  const rows = await database.getAllAsync<InventoryRow>('SELECT product_id, stock FROM inventory');
  const inventory = new Map(rows.map((row) => [row.product_id, row.stock]));
  return products.map((product) => ({
    ...product,
    stock: inventory.get(product.id) ?? product.stock,
  }));
}

export async function saveInventory(database: SQLite.SQLiteDatabase, products: Product[]) {
  const updatedAt = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    for (const product of products) {
      if (product.stock === null) continue;
      await database.runAsync(
        `INSERT INTO products_cache (id, name, price, image_url) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           price = excluded.price,
           image_url = excluded.image_url`,
        product.id,
        product.name,
        product.price,
        product.imageUrl,
      );
      await database.runAsync(
        `INSERT INTO inventory (product_id, stock, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET stock = excluded.stock, updated_at = excluded.updated_at`,
        product.id,
        product.stock,
        updatedAt,
      );
    }
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
