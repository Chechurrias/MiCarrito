# NOMA

Tienda de ropa minimalista con catálogo y stock sincronizados, ventas pendientes de validar, y comprobante PDF.

## Componentes

```text
┌──────────────────────────── Aplicación Expo ───────────────────────────┐
│ index.tsx: catálogo, carrito, checkout simulado y factura PDF           │
│ auth-screen.tsx: acceso ADMIN y cuentas de comprador en SQLite          │
│ admin-screen.tsx: gestión de productos y stock                          │
│                                                                        │
│ products.json: catálogo de respaldo offline                            │
│ services/store.ts ── SQLite: cuentas, carrito, stock en caché y pedidos│
│ services/api.ts   ── HTTP ───────────────────────────┐                 │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       ▼
                                      server/index.js (Express)
                                         │              │
                         catálogo / pedidos / admin de productos y stock
                                         │              │
                                         └──────┬───────┘
                                                ▼
                              Supabase products / orders / inventory
```

- **`src/app/index.tsx`** presenta la tienda y coordina las acciones del usuario.
- **`src/components/auth-screen.tsx`** permite iniciar sesión como ADMIN o crear/iniciar sesión con una cuenta de comprador local.
- **`src/components/admin-screen.tsx`** permite crear, editar, eliminar productos y ajustar sus existencias en Supabase.
- **`src/services/store.ts`** crea el ADMIN en SQLite en el primer inicio, guarda contraseñas con hash y sal, y conserva usuarios, carrito, una copia del stock recibido del servidor y ventas pendientes de validar.
- **`shared/products.json`** permite mostrar los tres productos al iniciar sin conexión o si la API no está disponible. Se reemplaza con el catálogo de Supabase al sincronizar.
- **`src/services/api.ts`** comunica la app con el backend; no contiene credenciales de Supabase.
- **`server/index.js`** expone el catálogo, registra órdenes y protege las operaciones ADMIN de productos e inventario con credenciales configuradas solo en el servidor.
- **Supabase** es la fuente de verdad del catálogo y conserva las ventas en `products` y `orders`.

## Flujo offline y sincronización

1. La app abre SQLite y muestra el catálogo de respaldo; luego intenta descargar el catálogo actual.
2. Al agregar o quitar unidades, SQLite conserva solo el ID del producto y la cantidad. El nombre y precio visibles se resuelven desde el catálogo actual.
3. Al enviar una venta, se guarda una solicitud pendiente en SQLite y se vacía el carrito en una transacción. La interfaz la muestra como pendiente; todavía no está confirmada ni se descuenta stock.
4. Cuando hay conexión, el backend valida y descuenta el stock de forma atómica en Supabase, registra la factura y devuelve la confirmación. Solo entonces la app elimina la solicitud de la cola local y actualiza la copia local del stock.
5. Mientras la tienda está abierta, la app consulta catálogo y órdenes pendientes cada cinco segundos. También sincroniza al recuperar conexión o al tocar el estado de sincronización.
6. Si falla la red, Supabase no responde o no hay stock suficiente, la venta permanece pendiente en el dispositivo. La app vuelve a intentar al recuperar conexión y periódicamente mientras está abierta; el comprobante no se marca como venta confirmada hasta que Supabase valide el stock.
7. Si una orden pendiente de una versión anterior contiene un ID que ya no existe en el catálogo, no se envía ni se reasigna a otro producto. La app conserva esa orden y muestra un aviso, pero sigue sincronizando los productos y las órdenes válidas.

## Ejecutar

```bash
npm install
npx expo start
```

Para enviar una venta, pulsa **Enviar venta a validar**. La app solo la marca como confirmada cuando Supabase valida y descuenta el stock. Luego puedes pulsar **Descargar factura PDF**. En Android y web se abre la vista de impresión; selecciona **Guardar como PDF**. En iOS se abre el menú para compartir el PDF.

## Supabase y servicio Node.js

Las tablas `products` y `orders` deben seguir el esquema proporcionado. `server/schema.sql` es solo un ejemplo para crear y cargar datos; no lo ejecutes sobre un catálogo ya configurado, pues también actualiza las filas de ejemplo. Las cuentas de compradores y el rol se guardan en SQLite en cada dispositivo; no se agrega una tabla de usuarios en Supabase.

### Inventario

Después de confirmar que existen `products` y `orders`, ejecuta `server/inventory.sql` en el SQL Editor de Supabase. Crea `inventory`, cuya clave `product_id` es a la vez clave primaria y clave foránea a `products.id`, el historial de movimientos y las funciones transaccionales de venta y guardado de productos. Si ya existía `products.stock` de una versión anterior, la migración copia sus valores a `inventory` antes de quitar esa columna. Los productos sin inventario comienzan en cero; actualiza `inventory.stock` con las cantidades físicas reales antes de habilitar ventas. No uses cantidades de ejemplo como inventario real. Ejecuta la migración también en proyectos donde ya exista `inventory` para instalar la función de gestión.

La app muestra el stock de la última sincronización como referencia. La decisión final siempre ocurre en Supabase: si dos clientes intentan comprar las mismas últimas unidades, la transacción solo confirma las unidades disponibles. Sin conexión, la solicitud queda pendiente de validar y no se considera una venta cerrada.

### Roles y acceso

El usuario `ADMIN` con contraseña inicial `123` se crea localmente en SQLite si aún no existe. Los compradores pueden crear usuario y contraseña en el dispositivo; ambas contraseñas se guardan como hash PBKDF2 con sal aleatoria. El login no depende de internet y se solicita otra vez al abrir la app. Las cuentas de comprador son locales a cada dispositivo y no se sincronizan entre teléfonos.

Las operaciones de administración requieren además que el servidor compare el usuario y contraseña ADMIN con `ADMIN_USERNAME` y `ADMIN_PASSWORD` en `server/.env`. Copia `server/.env.example` y configura `ADMIN_PASSWORD` con la misma contraseña que el ADMIN local. Nunca configures esas variables en la app ni publiques `server/.env`; usa HTTPS al desplegar la API. La contraseña inicial `123` es solo para demostración y debe sustituirse antes de usar el sistema en producción. Los compradores solo pueden consultar el catálogo y enviar compras; no pueden crear, editar ni borrar productos. Un producto con movimientos de inventario asociados no se puede borrar para conservar el historial.

### Ejecutar localmente

1. Copia `server/.env.example` a `server/.env` y configura `PORT=3000`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `ADMIN_PASSWORD`. La clave secreta y la contraseña ADMIN solo deben existir en el servidor. La contraseña ADMIN debe coincidir con la usada para iniciar sesión en la app.
2. Ejecuta `npm install --prefix server` una vez. Mantén `npm run api` activo en una terminal y `npx expo start` en otra.
3. Copia `.env.example` a `.env` y configura `EXPO_PUBLIC_API_URL`. Para un teléfono en la misma Wi-Fi, usa la IP local del equipo donde corre el servidor, no `localhost`.

### Desplegar la API en Render

El archivo [`render.yaml`](./render.yaml) define el servicio web. El repositorio debe estar subido a GitHub y conectado a Render como Blueprint:

1. Sube el proyecto a un repositorio Git remoto y, en Render, crea un **New Blueprint Instance** conectado a ese repositorio.
2. En la configuración del servicio, agrega `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ADMIN_USERNAME` y `ADMIN_PASSWORD`. La contraseña ADMIN debe coincidir con la de la cuenta local y no se debe subir al repositorio.
3. Después del primer deploy, copia la URL HTTPS del servicio a `EXPO_PUBLIC_API_URL` en `.env` y reinicia Expo. La app móvil debe usar la URL pública de Render, no la IP local.

Render sirve la API y conserva la única integración con Supabase. Los usuarios de la app viven en el dispositivo; desinstalar o borrar sus datos locales también elimina esa cuenta.

Las imágenes de `assets/images` que no aparecen en `app.json` ni en el código son recursos sobrantes del starter de Expo; no participan en el flujo de la tienda. Se conservan aquí para evitar eliminar recursos gráficos que podrían reutilizarse.
