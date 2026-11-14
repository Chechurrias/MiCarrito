# NOMA

Tienda de ropa minimalista con catálogo y stock sincronizados, ventas pendientes de validar, y comprobante PDF.

## Componentes

```text
┌──────────────────────────── Aplicación Expo ───────────────────────────┐
│ index.tsx: catálogo, carrito, checkout simulado y factura PDF           │
│ auth-screen.tsx: acceso ADMIN local ──┐                                 │
│                                                                        │
│ products.json: catálogo de respaldo offline                            │
│ services/store.ts ── SQLite: ADMIN, carrito, stock en caché y pendientes│
│ services/api.ts   ── HTTP ───────────────────────────┐                 │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       ▼
                                      server/index.js (Express)
                                         │              │
                                  GET /api/products  POST /api/orders
                                         │              │
                                         └──────┬───────┘
                                                ▼
                              Supabase products / orders / inventory
```

- **`src/app/index.tsx`** presenta la tienda y coordina las acciones del usuario.
- **`src/components/auth-screen.tsx`** permite ingresar únicamente como ADMIN local.
- **`src/services/store.ts`** crea el ADMIN en SQLite en el primer inicio y guarda la contraseña como hash con sal. También conserva el carrito, una copia del stock recibido del servidor y ventas pendientes de validar.
- **`shared/products.json`** permite mostrar los tres productos al iniciar sin conexión o si la API no está disponible. Se reemplaza con el catálogo de Supabase al sincronizar.
- **`src/services/api.ts`** comunica la app con el backend; no contiene credenciales de Supabase.
- **`server/index.js`** expone el catálogo y registra órdenes. El servidor obtiene de Supabase los precios vigentes y calcula el total antes de guardar cada orden.
- **Supabase** es la fuente de verdad del catálogo y conserva las ventas en `products` y `orders`.

## Flujo offline y sincronización

1. La app abre SQLite y muestra el catálogo de respaldo; luego intenta descargar el catálogo actual.
2. Al agregar o quitar unidades, SQLite conserva solo el ID del producto y la cantidad. El nombre y precio visibles se resuelven desde el catálogo actual.
3. Al enviar una venta, se guarda una solicitud pendiente en SQLite y se vacía el carrito en una transacción. La interfaz la muestra como pendiente; todavía no está confirmada ni se descuenta stock.
4. Cuando hay conexión, el backend valida y descuenta el stock de forma atómica en Supabase, registra la factura y devuelve la confirmación. Solo entonces la app elimina la solicitud de la cola local y actualiza la copia local del stock.
5. Mientras la tienda está abierta, la app consulta catálogo y órdenes pendientes cada cinco segundos. También sincroniza al recuperar conexión o al tocar el estado de sincronización.
6. Si falla la red, Supabase no responde o no hay stock suficiente, la venta permanece pendiente en el dispositivo. La app vuelve a intentar al recuperar conexión y periódicamente mientras está abierta; el comprobante no se marca como venta confirmada hasta que Supabase valide el stock.

## Ejecutar

```bash
npm install
npx expo start
```

Para enviar una venta, pulsa **Enviar venta a validar**. La app solo la marca como confirmada cuando Supabase valida y descuenta el stock. Luego puedes pulsar **Descargar factura PDF**. En Android y web se abre la vista de impresión; selecciona **Guardar como PDF**. En iOS se abre el menú para compartir el PDF.

## Supabase y servicio Node.js

Las tablas `products` y `orders` deben seguir el esquema proporcionado. `server/schema.sql` es solo un ejemplo para crear y cargar datos; no lo ejecutes sobre un catálogo ya configurado, pues también actualiza las filas de ejemplo.

### Inventario

Después de confirmar que existen `products` y `orders`, ejecuta `server/inventory.sql` en el SQL Editor de Supabase. Crea `inventory`, cuya clave `product_id` es a la vez clave primaria y clave foránea a `products.id`, además del historial de movimientos y la función transaccional de venta. Si ya existía `products.stock` de una versión anterior, la migración copia sus valores a `inventory` antes de quitar esa columna. Los productos sin inventario comienzan en cero; actualiza `inventory.stock` con las cantidades físicas reales antes de habilitar ventas. No uses cantidades de ejemplo como inventario real.

La app muestra el stock de la última sincronización como referencia. La decisión final siempre ocurre en Supabase: si dos clientes intentan comprar las mismas últimas unidades, la transacción solo confirma las unidades disponibles. Sin conexión, la solicitud queda pendiente de validar y no se considera una venta cerrada.

### Acceso local

El único usuario de la app es `ADMIN` con contraseña inicial `123`. Se crea localmente en SQLite si aún no existe y no hay registro de cuentas. La contraseña se guarda como hash PBKDF2 con sal aleatoria; el login no depende de internet y se solicita otra vez al abrir la app. Esta contraseña inicial es solo para demostración: no uses este login para proteger información sensible.

El login local controla el acceso a la interfaz, no autentica solicitudes al backend. Los endpoints de catálogo y órdenes son públicos; no uses la clave secreta en la app. Para proteger la API se necesita una autenticación del servidor diseñada para ese fin. El esquema actual tampoco vincula las órdenes a un usuario.

### Ejecutar localmente

1. Crea `server/.env` con `PORT=3000`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. La clave secreta solo debe existir en el servidor.
2. Ejecuta `npm install --prefix server` una vez. Mantén `npm run api` activo en una terminal y `npx expo start` en otra.
3. Copia `.env.example` a `.env` y configura `EXPO_PUBLIC_API_URL`. Para un teléfono en la misma Wi-Fi, usa la IP local del equipo donde corre el servidor, no `localhost`.

### Desplegar la API en Render

El archivo [`render.yaml`](./render.yaml) define el servicio web. El repositorio debe estar subido a GitHub y conectado a Render como Blueprint:

1. Sube el proyecto a un repositorio Git remoto y, en Render, crea un **New Blueprint Instance** conectado a ese repositorio.
2. En la configuración del servicio, agrega `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. No subas claves al repositorio.
3. Después del primer deploy, copia la URL HTTPS del servicio a `EXPO_PUBLIC_API_URL` en `.env` y reinicia Expo. La app móvil debe usar la URL pública de Render, no la IP local.

Render sirve la API y conserva la única integración con Supabase. Los usuarios de la app viven en el dispositivo; desinstalar o borrar sus datos locales también elimina esa cuenta.

Las imágenes de `assets/images` que no aparecen en `app.json` ni en el código son recursos sobrantes del starter de Expo; no participan en el flujo de la tienda. Se conservan aquí para evitar eliminar recursos gráficos que podrían reutilizarse.
