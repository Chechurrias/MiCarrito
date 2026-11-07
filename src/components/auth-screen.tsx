import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

import { isSupabaseConfigured, supabase } from '@/services/supabase';

const colors = {
  background: '#F6F4EF',
  surface: '#FFFFFF',
  text: '#242720',
  muted: '#77796F',
  green: '#385A47',
};

type Props = {
  initialMessage?: string;
};

export default function AuthScreen({ initialMessage = '' }: Props) {
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const client = supabase;
    if (!client || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (creatingAccount) {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session) {
          setMessage('Cuenta creada. Confirma tu correo y luego inicia sesión.');
        }
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Intenta de nuevo.';
      setMessage(details);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.logo}>NOMA.</Text>
        <Text style={styles.title}>{creatingAccount ? 'Crear cuenta' : 'Bienvenido'}</Text>
        <Text style={styles.subtitle}>Inicia sesión con tu cuenta de Supabase.</Text>

        <TextInput
          accessibilityLabel="Correo electrónico"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Correo electrónico"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={email}
        />
        <TextInput
          accessibilityLabel="Contraseña"
          autoCapitalize="none"
          autoComplete={creatingAccount ? 'new-password' : 'current-password'}
          onChangeText={setPassword}
          placeholder="Contraseña"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          value={password}
        />

        {message ? <Text style={styles.message}>{message}</Text> : null}
        {!isSupabaseConfigured ? (
          <Text style={styles.message}>Configura la URL y la clave pública de Supabase en el archivo .env.</Text>
        ) : null}

        <Pressable
          disabled={!isSupabaseConfigured || busy || !email || !password}
          onPress={() => void submit()}
          style={[styles.button, (!isSupabaseConfigured || busy || !email || !password) && styles.disabled]}>
          <Text style={styles.buttonText}>
            {busy ? 'Un momento…' : creatingAccount ? 'Crear cuenta' : 'Iniciar sesión'}
          </Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            setCreatingAccount((current) => !current);
            setMessage('');
          }}>
          <Text style={styles.switch}>
            {creatingAccount ? 'Ya tengo una cuenta · Iniciar sesión' : 'Crear una cuenta nueva'}
          </Text>
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
  switch: { color: colors.green, fontSize: 13, fontWeight: '600', marginTop: 20, textAlign: 'center' },
});
