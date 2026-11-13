import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

import { authenticateAdmin } from '@/services/store';
import type { openStore } from '@/services/store';

const colors = {
  background: '#F6F4EF',
  surface: '#FFFFFF',
  text: '#242720',
  muted: '#77796F',
};

type Props = {
  database: Awaited<ReturnType<typeof openStore>>;
  onLogin: () => void;
};

export default function AuthScreen({ database, onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (await authenticateAdmin(database, username, password)) onLogin();
      else setMessage('Usuario o contraseña incorrectos.');
    } catch (error) {
      console.error('No se pudo verificar el usuario local.', error);
      setMessage('No se pudo verificar el usuario local.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.logo}>NOMA.</Text>
        <Text style={styles.title}>Bienvenido</Text>
        <Text style={styles.subtitle}>Inicia sesión para continuar.</Text>

        <TextInput
          accessibilityLabel="Usuario"
          autoCapitalize="characters"
          autoComplete="username"
          onChangeText={setUsername}
          placeholder="Usuario"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={username}
        />
        <TextInput
          accessibilityLabel="Contraseña"
          autoCapitalize="none"
          autoComplete="current-password"
          onChangeText={setPassword}
          placeholder="Contraseña"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          value={password}
        />

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Pressable
          disabled={busy || !username || !password}
          onPress={() => void submit()}
          style={[styles.button, (busy || !username || !password) && styles.disabled]}>
          <Text style={styles.buttonText}>{busy ? 'Un momento…' : 'Iniciar sesión'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', padding: 28, alignSelf: 'center', width: '100%', maxWidth: 480 },
  logo: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 32, fontWeight: '600', marginTop: 32 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 8, marginBottom: 24 },
  input: { backgroundColor: colors.surface, borderRadius: 10, color: colors.text, fontSize: 15, marginTop: 12, padding: 15 },
  message: { color: '#A43E32', fontSize: 12, lineHeight: 18, marginTop: 14 },
  button: { alignItems: 'center', backgroundColor: colors.text, borderRadius: 11, justifyContent: 'center', marginTop: 20, minHeight: 50 },
  disabled: { opacity: 0.55 },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
});
