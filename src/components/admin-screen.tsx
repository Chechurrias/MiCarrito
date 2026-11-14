import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { API_URL, createProduct, deleteProduct, getCatalog, updateProduct } from '@/services/api';
import type { AdminCredentials, ProductInput } from '@/services/api';
import type { Product } from '@/data/products';

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

type Props = {
  credentials: AdminCredentials;
  onSignOut: () => void;
};

export default function AdminScreen({ credentials, onSignOut }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [stock, setStock] = useState('0');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [message, setMessage] = useState(
    API_URL ? '' : 'Configura EXPO_PUBLIC_API_URL para administrar productos.',
  );
  const [busy, setBusy] = useState(!!API_URL);

  const loadProducts = useCallback(async () => {
    if (!API_URL) {
      setMessage('Configura EXPO_PUBLIC_API_URL para administrar productos.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      setProducts(await getCatalog());
    } catch (error) {
      console.error('No se pudo cargar el inventario.', error);
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar el inventario.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!API_URL) return () => { active = false; };

    void getCatalog()
      .then((catalog) => {
        if (active) setProducts(catalog);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('No se pudo cargar el inventario.', error);
        setMessage(error instanceof Error ? error.message : 'No se pudo cargar el inventario.');
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function resetForm() {
    setName('');
    setPrice('');
    setImageUrl('');
    setStock('0');
    setEditingId(null);
  }

  function edit(product: Product) {
    setEditingId(product.id);
    setName(product.name);
    setPrice(String(product.price));
    setImageUrl(product.imageUrl);
    setStock(String(product.stock ?? 0));
    setMessage('');
  }

  async function save() {
    if (busy) return;
    const parsedPrice = Number(price);
    const parsedStock = Number(stock);
    if (!name.trim() || !Number.isSafeInteger(parsedPrice) || parsedPrice < 1) {
      setMessage('Ingresa un nombre y un precio entero mayor que cero.');
      return;
    }
    if (!Number.isSafeInteger(parsedStock) || parsedStock < 0) {
      setMessage('El stock debe ser un número entero igual o mayor que cero.');
      return;
    }

    const input: ProductInput = {
      name: name.trim(),
      price: parsedPrice,
      imageUrl: imageUrl.trim(),
      stock: parsedStock,
    };

    setBusy(true);
    setMessage('');
    try {
      const savedProduct = editingId
        ? await updateProduct(editingId, input, credentials)
        : await createProduct(input, credentials);
      setProducts((current) =>
        editingId
          ? current.map((product) => (product.id === savedProduct.id ? savedProduct : product))
          : [...current, savedProduct].sort((first, second) => first.name.localeCompare(second.name)),
      );
      resetForm();
      setMessage(editingId ? 'Producto actualizado.' : 'Producto creado.');
    } catch (error) {
      console.error('No se pudo guardar el producto.', error);
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar el producto.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || busy) return;
    const product = deleteTarget;
    setBusy(true);
    setMessage('');
    try {
      await deleteProduct(product.id, credentials);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      if (editingId === product.id) resetForm();
      setDeleteTarget(null);
      setMessage('Producto eliminado.');
    } catch (error) {
      console.error('No se pudo eliminar el producto.', error);
      setMessage(error instanceof Error ? error.message : 'No se pudo eliminar el producto.');
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View>
              <Text style={styles.logo}>NOMA.</Text>
              <Text style={styles.subtitle}>ADMIN · INVENTARIO</Text>
            </View>
            <Pressable onPress={onSignOut} disabled={busy}>
              <Text style={styles.signOut}>Cerrar sesión</Text>
            </Pressable>
          </View>

          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>PRODUCTOS Y STOCK</Text>
            <Pressable onPress={() => void loadProducts()} disabled={busy || !API_URL}>
              <Text style={styles.refresh}>{busy ? 'Cargando…' : 'Actualizar'}</Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            <Text style={styles.formTitle}>{editingId ? 'Editar producto' : 'Nuevo producto'}</Text>
            <TextInput
              accessibilityLabel="Nombre del producto"
              onChangeText={setName}
              placeholder="Nombre"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={name}
            />
            <View style={styles.fieldRow}>
              <TextInput
                accessibilityLabel="Precio en pesos"
                keyboardType="number-pad"
                onChangeText={setPrice}
                placeholder="Precio (COP)"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.halfField]}
                value={price}
              />
              <TextInput
                accessibilityLabel="Unidades en stock"
                keyboardType="number-pad"
                onChangeText={setStock}
                placeholder="Stock"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.halfField]}
                value={stock}
              />
            </View>
            <TextInput
              accessibilityLabel="URL de imagen"
              autoCapitalize="none"
              keyboardType="url"
              onChangeText={setImageUrl}
              placeholder="URL de imagen (https://...)"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={imageUrl}
            />
            <View style={styles.formActions}>
              {editingId ? (
                <Pressable onPress={resetForm} disabled={busy} style={styles.secondaryButton}>
                  <Text style={styles.secondaryText}>Cancelar</Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={busy || !API_URL}
                onPress={() => void save()}
                style={[styles.primaryButton, (busy || !API_URL) && styles.disabled]}>
                <Text style={styles.primaryText}>
                  {busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear producto'}
                </Text>
              </Pressable>
            </View>
          </View>

          {message ? <Text style={styles.message}>{message}</Text> : null}

          {products.map((product) => (
            <View key={product.id} style={styles.product}>
              <View style={styles.productDetails}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productInfo}>{money(product.price)}</Text>
                <Text style={styles.stock}>
                  Stock: {product.stock === null ? 'No disponible' : product.stock}
                </Text>
              </View>
              <View style={styles.productActions}>
                <Pressable
                  accessibilityLabel={`Editar ${product.name}`}
                  disabled={busy}
                  onPress={() => edit(product)}
                  style={styles.actionButton}>
                  <Text style={styles.actionText}>Editar</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={`Eliminar ${product.name}`}
                  disabled={busy}
                  onPress={() => setDeleteTarget(product)}
                  style={[styles.actionButton, styles.deleteButton]}>
                  <Text style={styles.deleteText}>Eliminar</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {!products.length && !busy ? (
            <Text style={styles.empty}>No hay productos para mostrar.</Text>
          ) : null}
        </ScrollView>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setDeleteTarget(null)}
        transparent
        visible={deleteTarget !== null}>
        <View style={styles.modalShade}>
          <View style={styles.confirmCard}>
            <Text style={styles.formTitle}>Eliminar producto</Text>
            <Text style={styles.confirmText}>
              {deleteTarget
                ? `¿Eliminar “${deleteTarget.name}”? Si tiene ventas registradas, no podrá eliminarse.`
                : ''}
            </Text>
            <View style={styles.formActions}>
              <Pressable
                onPress={() => setDeleteTarget(null)}
                disabled={busy}
                style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => void confirmDelete()}
                disabled={busy}
                style={[styles.primaryButton, styles.dangerButton]}>
                <Text style={styles.primaryText}>{busy ? 'Eliminando…' : 'Eliminar'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: 560 },
  content: { padding: 22, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  logo: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 6 },
  signOut: { color: colors.green, fontSize: 12, fontWeight: '600' },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  refresh: { color: colors.green, fontSize: 12, fontWeight: '600' },
  form: { backgroundColor: colors.surface, borderRadius: 13, padding: 15, marginBottom: 16 },
  formTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 9,
    color: colors.text,
    fontSize: 14,
    marginTop: 9,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  fieldRow: { flexDirection: 'row', gap: 9 },
  halfField: { flex: 1 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 12 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 9,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 15,
  },
  primaryText: { color: colors.surface, fontSize: 12, fontWeight: '700' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 15,
  },
  secondaryText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  disabled: { opacity: 0.55 },
  product: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
    padding: 14,
  },
  productDetails: { flex: 1, paddingRight: 10 },
  productName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  productInfo: { color: colors.muted, fontSize: 12, marginTop: 5 },
  stock: { color: colors.green, fontSize: 12, fontWeight: '600', marginTop: 4 },
  productActions: { alignItems: 'flex-end', gap: 8 },
  actionButton: { backgroundColor: '#E7EDE7', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: colors.green, fontSize: 11, fontWeight: '700' },
  deleteButton: { backgroundColor: '#F8E8E5' },
  deleteText: { color: '#A43E32', fontSize: 11, fontWeight: '700' },
  message: { color: '#A43E32', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  empty: { color: colors.muted, paddingVertical: 24, textAlign: 'center' },
  modalShade: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    maxWidth: 420,
    padding: 20,
    width: '100%',
  },
  confirmText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  dangerButton: { backgroundColor: '#A43E32' },
});
