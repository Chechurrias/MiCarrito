import { Image } from 'expo-image';
import * as Network from 'expo-network';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AuthScreen from '@/components/auth-screen';
import { PRODUCTS, type Product } from '@/data/products';
import { API_URL, getCatalog, sendOrder } from '@/services/api';
import { isSupabaseConfigured, supabase } from '@/services/supabase';
import {
  changeQuantity,
  createOrder,
  getCart,
  getPendingOrders,
  openStore,
  removeOne,
  removePendingOrder,
  type CartItem,
  type Order,
} from '@/services/store';

type StoreDatabase = Awaited<ReturnType<typeof openStore>>;
type Screen = 'cart' | 'invoice' | null;

const colors = {
  background: '#F6F4EF',
  surface: '#FFFFFF',
  text: '#242720',
  muted: '#77796F',
  green: '#385A47',
  border: '#E8E5DC',
};

const money = (amount: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char);

async function syncStore(
  database: StoreDatabase,
  accessToken: string,
  updateCatalog: (products: Product[]) => Promise<void>,
  updateOrder: (order: Order) => void = () => {},
) {
  const products = await getCatalog();
  await updateCatalog(products);
  for (const order of await getPendingOrders(database)) {
    const savedOrder = await sendOrder(order, accessToken);
    await removePendingOrder(database, order.id);
    updateOrder(savedOrder);
  }
  return products;
}

function invoiceHtml(order: Order) {
  const items = order.items
    .map((item) => `<p>${escapeHtml(item.name)} · ${item.quantity} × ${money(item.price)}</p>`)
    .join('');
  return `
    <meta charset="utf-8">
    <main>
      <h1>NOMA · Comprobante de compra</h1>
      <p>Factura ${escapeHtml(order.id)}</p>
      <p>${new Date(order.createdAt).toLocaleString('es-CO')}</p>
      ${items}
      <h2>Total · ${money(order.total)}</h2>
      <p>Pago simulado exitoso. Gracias por tu compra.</p>
    </main>`;
}

function printInvoiceOnWeb(html: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Permite ventanas emergentes para guardar la factura como PDF.');
  }

  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Factura NOMA</title>
        <style>
          body { font-family: Arial, sans-serif; color: #242720; padding: 32px; }
          main { max-width: 640px; margin: 0 auto; }
          h1 { font-size: 24px; }
          h2 { border-top: 1px solid #ccc; padding-top: 16px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>${html}</body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export default function StoreScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authMessage, setAuthMessage] = useState('');

  useEffect(() => {
    const client = supabase;
    if (!client || !isSupabaseConfigured) return;

    let active = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthMessage('');
      setAuthLoading(false);
    });

    void client.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAuthMessage(error.message);
        setSession(data.session);
        setAuthLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthMessage(error instanceof Error ? error.message : 'No se pudo leer la sesión.');
        setAuthLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.loading}>Cargando sesión…</Text>
      </SafeAreaView>
    );
  }
  if (!session) return <AuthScreen initialMessage={authMessage} />;

  return <StoreContent session={session} />;
}

function StoreContent({ session }: { session: Session }) {
  const [database, setDatabase] = useState<StoreDatabase | null>(null);
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const [screen, setScreen] = useState<Screen>(null);
  const [status, setStatus] = useState(API_URL ? 'Sincronizando…' : 'Servicio API no configurado');
  const [message, setMessage] = useState('');
  const [orderSyncStatus, setOrderSyncStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const syncing = useRef(false);
  const currentOrderId = useRef<string | null>(null);
  const savedOrderIds = useRef(new Set<string>());

  const count = cart.reduce((total, item) => total + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const synchronize = useCallback(async (db: StoreDatabase) => {
    if (!API_URL || syncing.current) return false;
    syncing.current = true;
    setStatus('Sincronizando…');
    try {
      await syncStore(
        db,
        session.access_token,
        async (syncedProducts) => {
          setProducts(syncedProducts);
          setCart(await getCart(db, syncedProducts));
        },
        (syncedOrder) => {
          savedOrderIds.current.add(syncedOrder.id);
          setOrder((current) => (current?.id === syncedOrder.id ? syncedOrder : current));
          if (currentOrderId.current === syncedOrder.id) {
            setOrderSyncStatus('Orden guardada en Supabase.');
          }
        },
      );
      setStatus('Catálogo actualizado');
      return true;
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Error desconocido.';
      console.warn('La sincronización quedó pendiente.', error);
      setStatus('Sin conexión · reintento en 5 s');
      if (currentOrderId.current && !savedOrderIds.current.has(currentOrderId.current)) {
        setOrderSyncStatus(`Pendiente de sincronizar: ${details}`);
      }
      return false;
    } finally {
      syncing.current = false;
    }
  }, [session.access_token]);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        const db = await openStore();
        const savedCart = await getCart(db);
        if (!active) return;
        setDatabase(db);
        setCart(savedCart);

        if (API_URL) {
          await synchronize(db);
        }
      } catch (error) {
        console.error('No se pudo abrir la tienda.', error);
        if (active) setMessage('No se pudo abrir la tienda.');
      }
    }

    void start();
    return () => {
      active = false;
    };
  }, [synchronize]);

  useEffect(() => {
    if (!database || !API_URL) return;

    const subscription = Network.addNetworkStateListener((state) => {
      if (!state.isConnected) return;
      void synchronize(database);
    });
    const interval = setInterval(() => {
      void synchronize(database);
    }, 5000);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [database, synchronize]);

  async function refreshCart() {
    if (database) setCart(await getCart(database, products));
  }

  async function updateProduct(product: Product, quantity: number) {
    if (!database || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (quantity < 0) {
        await removeOne(database, product.id);
      } else {
        await changeQuantity(database, product.id);
      }
      await refreshCart();
    } catch (error) {
      console.error('No se pudo actualizar el carrito.', error);
      setMessage('No se pudo actualizar el carrito.');
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (!database || cart.length === 0 || busy) return;
    setBusy(true);
    setMessage('');
    try {
      let checkoutCart = cart;
      if (API_URL) {
        try {
          const network = await Network.getNetworkStateAsync();
          if (network.isConnected && network.isInternetReachable !== false) {
            const latestProducts = await getCatalog();
            setProducts(latestProducts);
            checkoutCart = await getCart(database, latestProducts);
            setCart(checkoutCart);
          }
        } catch (error) {
          console.warn('Se usará el último precio disponible para la compra sin conexión.', error);
        }
      }

      const newOrder = await createOrder(database, checkoutCart);
      currentOrderId.current = newOrder.id;
      setCart([]);
      setOrder(newOrder);
      setOrderSyncStatus(API_URL ? 'Sincronizando con Supabase…' : 'Pendiente: servicio API no configurado.');
      setScreen('invoice');
      if (API_URL) {
        const synced = await synchronize(database);
        if (!synced) {
          setMessage('La compra quedó guardada en este dispositivo y se reintentará automáticamente.');
        }
      }
    } catch (error) {
      console.error('No se pudo guardar la compra.', error);
      setMessage('No se pudo completar la compra. Tu carrito sigue guardado.');
    } finally {
      setBusy(false);
    }
  }

  async function downloadInvoice() {
    if (!order || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const html = invoiceHtml(order);
      if (Platform.OS === 'web') {
        printInvoiceOnWeb(html);
      } else if (Platform.OS === 'android') {
        await Print.printAsync({ html });
        setMessage('En la pantalla de impresión, selecciona “Guardar como PDF”.');
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: '.pdf' });
      }
    } catch (error) {
      console.error('No se pudo generar la factura.', error);
      const details = error instanceof Error ? ` ${error.message}` : '';
      setMessage(`No se pudo generar la factura.${details}`);
    } finally {
      setBusy(false);
    }
  }

  async function retrySync() {
    if (!database || !API_URL || busy) return;
    setBusy(true);
    try {
      await synchronize(database);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const client = supabase;
    if (!client || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch (error) {
      const details = error instanceof Error ? error.message : 'No se pudo cerrar sesión.';
      setMessage(details);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.logo}>NOMA.</Text>
            <View style={styles.account}>
              <Text style={styles.status}>{session.user.email}</Text>
              <Pressable onPress={() => void retrySync()} disabled={!API_URL || busy}>
                <Text style={styles.status}>{status}</Text>
              </Pressable>
              <Pressable onPress={() => void signOut()} disabled={busy}>
                <Text style={styles.signOut}>Cerrar sesión</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.overline}>VESTIR CON INTENCIÓN</Text>
          <Text style={styles.title}>Menos, pero{'\n'}mejor.</Text>
          <Text style={styles.intro}>Tres prendas esenciales, cómodas y hechas para cada día.</Text>

          {order && (
            <Pressable onPress={() => setScreen('invoice')}>
              <Text style={styles.link}>Ver último comprobante</Text>
            </Pressable>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>LA COLECCIÓN</Text>
            {products.map((product) => (
              <View key={product.id} style={styles.product}>
                <Image
                  source={{ uri: product.imageUrl }}
                  style={styles.image}
                  contentFit="cover"
                  cachePolicy="disk"
                  accessibilityLabel={product.name}
                />
                <View style={styles.productDetails}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <View style={styles.productFooter}>
                    <Text style={styles.price}>{money(product.price)}</Text>
                    <Pressable
                      onPress={() => void updateProduct(product, 1)}
                      disabled={!database || busy}
                      style={styles.addButton}>
                      <Text style={styles.addText}>Agregar +</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Text style={styles.note}>Diseño sencillo. Uso constante.</Text>
        </ScrollView>

        <Pressable
          disabled={!database}
          onPress={() => {
            setMessage('');
            setScreen('cart');
          }}
          style={styles.cartButton}>
          <View>
            <Text style={styles.cartTitle}>Ver carrito · {count}</Text>
            <Text style={styles.cartPrice}>{money(total)}</Text>
          </View>
          <Text style={styles.arrow}>↗</Text>
        </Pressable>
      </View>

      <Modal visible={screen !== null} transparent animationType="slide" onRequestClose={() => setScreen(null)}>
        <Pressable style={styles.shade} onPress={() => setScreen(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{screen === 'invoice' ? 'Tu comprobante' : 'Tu carrito'}</Text>
            <Pressable onPress={() => setScreen(null)}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          {screen === 'cart' ? (
            <>
              {cart.length === 0 ? (
                <Text style={styles.empty}>Tu carrito está vacío.</Text>
              ) : (
                <ScrollView style={styles.cartItems}>
                  {cart.map((item) => (
                    <View key={item.productId} style={styles.cartRow}>
                      <View style={styles.cartDescription}>
                        <Text style={styles.productName}>{item.name}</Text>
                        <Text style={styles.description}>{money(item.price)}</Text>
                      </View>
                      <Pressable onPress={() => {
                        const product = products.find((p) => p.id === item.productId);
                        if (product) void updateProduct(product, -1);
                      }}>
                        <Text style={styles.step}>−</Text>
                      </Pressable>
                      <Text style={styles.quantity}>{item.quantity}</Text>
                      <Pressable onPress={() => {
                        const product = products.find((p) => p.id === item.productId);
                        if (product) void updateProduct(product, 1);
                      }}>
                        <Text style={styles.step}>+</Text>
                      </Pressable>
                      <Text style={styles.price}>{money(item.price * item.quantity)}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalPrice}>{money(total)}</Text>
              </View>
              <Pressable
                disabled={!cart.length || busy}
                onPress={() => void checkout()}
                style={styles.payButton}>
                <Text style={styles.payText}>{busy ? 'Un momento…' : 'Pagar · simulado'}</Text>
              </Pressable>
              <Text style={styles.smallNote}>Pago de demostración · no se realiza ningún cobro.</Text>
            </>
          ) : order ? (
            <>
              <Text style={styles.success}>Pago simulado exitoso ✓</Text>
              {orderSyncStatus ? <Text style={styles.description}>{orderSyncStatus}</Text> : null}
              <Text style={styles.description}>
                Factura {order.id} · {new Date(order.createdAt).toLocaleDateString('es-CO')}
              </Text>
              {order.items.map((item) => (
                <View key={item.productId} style={styles.invoiceRow}>
                  <Text style={styles.productName}>{item.name} × {item.quantity}</Text>
                  <Text style={styles.price}>{money(item.price * item.quantity)}</Text>
                </View>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalPrice}>{money(order.total)}</Text>
              </View>
              <Pressable disabled={busy} onPress={() => void downloadInvoice()} style={styles.payButton}>
                <Text style={styles.payText}>{busy ? 'Un momento…' : 'Descargar factura PDF'}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.empty}>Aún no tienes compras.</Text>
          )}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 520 },
  content: { padding: 22, paddingBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 42 },
  account: { alignItems: 'flex-end', gap: 4 },
  logo: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  status: { color: colors.muted, fontSize: 11 },
  signOut: { color: colors.green, fontSize: 11, fontWeight: '600' },
  loading: { color: colors.muted, margin: 'auto', textAlign: 'center' },
  overline: { color: colors.green, fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 42, fontWeight: '600', letterSpacing: -1.6, lineHeight: 46, marginTop: 12 },
  intro: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 300 },
  link: { color: colors.green, fontSize: 12, fontWeight: '600', marginTop: 13 },
  section: { marginTop: 32 },
  sectionTitle: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3, marginBottom: 12 },
  product: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 13, padding: 8, marginBottom: 10 },
  image: { width: 100, height: 112, borderRadius: 9, backgroundColor: colors.border },
  productDetails: { flex: 1, justifyContent: 'center', paddingHorizontal: 13 },
  productName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  description: { color: colors.muted, fontSize: 11, marginTop: 4 },
  productFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  price: { color: colors.text, fontSize: 12, fontWeight: '600' },
  addButton: { backgroundColor: '#E7EDE7', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  addText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 12 },
  message: { color: '#A43E32', fontSize: 12, marginTop: 12 },
  cartButton: { backgroundColor: colors.text, borderRadius: 13, padding: 15, marginHorizontal: 22, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cartTitle: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  cartPrice: { color: '#D5D5CD', fontSize: 10, marginTop: 4 },
  arrow: { color: colors.surface, fontSize: 22 },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, paddingBottom: 32, maxHeight: '80%', marginTop: 'auto' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: '600' },
  close: { color: colors.text, fontSize: 26 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: 28 },
  cartItems: { flexGrow: 0 },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 },
  cartDescription: { flex: 1 },
  step: { color: colors.green, fontSize: 20, paddingHorizontal: 4 },
  quantity: { color: colors.text, fontSize: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 16, marginTop: 8 },
  totalLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  totalPrice: { color: colors.text, fontSize: 15, fontWeight: '700' },
  payButton: { backgroundColor: colors.text, minHeight: 50, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  payText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  smallNote: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 9 },
  success: { color: colors.green, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 13 },
});
