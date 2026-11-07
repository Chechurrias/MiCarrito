# NOMA

Tienda de ropa minimalista con catálogo sincronizado, carrito persistente en SQLite, pago simulado y comprobante PDF.

## Componentes

```text
┌──────────────────────────── Aplicación Expo ───────────────────────────┐
│ index.tsx: catálogo, carrito, checkout simulado y factura PDF           │
│                                                                        │
│ products.json: catálogo de respaldo offline                            │
│ services/store.ts ── SQLite: carrito y órdenes pendientes              │
│ services/api.ts   ── HTTP + token ───────────────────┐                 │
└──────────────────────────────────────────────────────┼─────────────────┘
                                                       ▼
                                      server/index.js (Express)
                                         │              │
                                  GET /api/products  POST /api/orders
                                         │              │
                                         └──────┬───────┘
                                                ▼
                                       Supabase products / orders
Aplicación ── correo/contraseña ── Supabase Auth
```

- **`src/app/index.tsx`** presenta la tienda y coordina las acciones del usuario.
- **`src/services/store.ts`** guarda en SQLite los IDs y cantidades del carrito, además de órdenes pendientes de envío.
- **`shared/products.json`** permite mostrar los tres productos al iniciar sin conexión o si la API no está disponible. Se reemplaza con el catálogo de Supabase al sincronizar.
- **`src/services/api.ts`** comunica la app con el backend; no contiene credenciales de Supabase.
- **`src/services/supabase.ts`** inicia Supabase Auth con la clave publicable y conserva la sesión del usuario en el dispositivo.
- **`server/index.js`** expone el catálogo y registra órdenes. El servidor obtiene de Supabase los precios vigentes y calcula el total antes de guardar cada orden.
- **Supabase** es la fuente de verdad del catálogo y conserva las ventas en `products` y `orders`.

## Flujo offline y sincronización

1. La app abre SQLite y muestra el catálogo de respaldo; luego intenta descargar el catálogo actual.
2. Al agregar o quitar unidades, SQLite conserva solo el ID del producto y la cantidad. El nombre y precio visibles se resuelven desde el catálogo actual.
3. Al pagar, se guarda una orden pendiente en SQLite y se vacía el carrito en una transacción. El pago es una simulación: no se cobra dinero.
4. Cuando hay conexión, la app actualiza el catálogo y envía las órdenes pendientes. El backend usa los precios actuales de Supabase, guarda la orden y devuelve el comprobante actualizado; solo entonces la app elimina la orden pendiente local.
5. Mientras la tienda está abierta, la app consulta catálogo y órdenes pendientes cada cinco segundos. También sincroniza al recuperar conexión o al tocar el estado de sincronización.
6. Si falla la red o el servicio, el carrito o la orden pendiente permanecen en el dispositivo. El recibo muestra el motivo del error y el siguiente intento automático.

## Ejecutar

```bash
npm install
npx expo start
```

Para generar la factura, pulsa **Pagar · simulado** y luego **Descargar factura PDF**. En Android y web se abre la vista de impresión; selecciona **Guardar como PDF**. En iOS se abre el menú para compartir el PDF.

## Supabase y servicio Node.js

Las tablas `products` y `orders` deben seguir el esquema proporcionado. `server/schema.sql` es solo un ejemplo para crear y cargar datos; no lo ejecutes sobre un catálogo ya configurado, pues también actualiza las filas de ejemplo.

### Login

La app permite crear una cuenta e iniciar sesión con correo y contraseña mediante Supabase Auth. Si Supabase requiere confirmación por correo, el usuario debe confirmar su dirección antes de iniciar sesión. El backend exige un token válido para aceptar órdenes; el catálogo sigue siendo público.

El esquema solicitado no tiene una columna de propietario para `orders`. Por eso, las órdenes autenticadas se guardan en la tabla existente, pero no se vinculan ni se filtran por usuario. El servicio no ofrece un endpoint para consultar órdenes. Para tener historial privado por cuenta, habría que agregar `user_id` y políticas RLS.

### Ejecutar localmente

1. Copia `server/.env.example` a `server/.env` y configura `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`. Rota la clave secreta que se compartió anteriormente y usa la nueva solo en el servidor.
2. Ejecuta `npm install --prefix server` una vez. Mantén `npm run api` activo en una terminal y `npx expo start` en otra.
3. Copia `.env.example` a `.env`. Configura `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `EXPO_PUBLIC_API_URL`. Para un teléfono en la misma Wi-Fi, usa la IP local del equipo donde corre el servidor, no `localhost`.

### Desplegar la API en Render

El archivo [`render.yaml`](./render.yaml) define el servicio web. El repositorio debe estar subido a GitHub y conectado a Render como Blueprint:

1. Sube el proyecto a un repositorio Git remoto y, en Render, crea un **New Blueprint Instance** conectado a ese repositorio.
2. En la configuración del servicio, agrega `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` y una nueva `SUPABASE_SECRET_KEY`. No subas claves al repositorio ni uses en Render la clave secreta previamente compartida.
3. Después del primer deploy, copia la URL HTTPS del servicio a `EXPO_PUBLIC_API_URL` en `.env` y reinicia Expo. La app móvil debe usar la URL pública de Render, no la IP local.

Render sirve la API; las cuentas y contraseñas las gestiona Supabase Auth. La clave secreta de Supabase solo vive en Render o en `server/.env` local.

Las imágenes de `assets/images` que no aparecen en `app.json` ni en el código son recursos sobrantes del starter de Expo; no participan en el flujo de la tienda. Se conservan aquí para evitar eliminar recursos gráficos que podrían reutilizarse.
