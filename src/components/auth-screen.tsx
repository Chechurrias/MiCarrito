import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  type openStore,
  authenticateUser,
  createCustomerAccount,
  type UserRole,
} from '@/services/store';

const colors = {
  background: '#F6F4EF',
  surface: '#FFFFFF',
  text: '#242720',
  muted: '#77796F',
};

type Props = {
  database: Awaited<ReturnType<typeof openStore>>;
  onLogin: (role: UserRole, username: string, adminPassword?: string) => void;
};

export default function AuthScreen({ database, onLogin }: Props) {
  const [role, setRole] = useState<UserRole>('CUSTOMER');
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (registering) {
        const createdUsername = await createCustomerAccount(database, username, password);
        onLogin('CUSTOMER', createdUsername);
        return;
      }

      const authenticatedRole = await authenticateUser(database, username, password);
      if (authenticatedRole !== role) {
        setMessage('Usuario o contraseña incorrectos.');
        return;
      }
      onLogin(
        authenticatedRole,
        username.trim().toUpperCase(),
        authenticatedRole === 'ADMIN' ? password : undefined,
      );
    } catch (error) {
      console.error('No se pudo completar el acceso local.', error);
      setMessage(error instanceof Error ? error.message : 'No se pudo completar el acceso local.');
    } finally {
      setBusy(false);
    }
  }

  function selectRole(nextRole: UserRole) {
    setRole(nextRole);
    setRegistering(false);
    setMessage('');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.logo}>NOMA.</Text>
        <Text style={styles.title}>Bienvenido</Text>
        <Text style={styles.subtitle}>Inicia sesión para continuar.</Text>

        <View style={styles.roleSelector}>
          {(['CUSTOMER', 'ADMIN'] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected: role === option }}
              onPress={() => selectRole(option)}
              style={[styles.roleButton, role === option && styles.selectedRole]}>
              <Text style={[styles.roleText, role === option && styles.selectedRoleText]}>
                {option === 'CUSTOMER' ? 'COMPRAR' : 'ADMIN'}
              </Text>
            </Pressable>
          ))}
        </View>

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
          autoComplete={registering ? 'new-password' : 'current-password'}
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
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
          <Text style={styles.buttonText}>
            {busy
              ? 'Un momento…'
              : registering
                ? 'Crear cuenta'
                : 'Iniciar sesión'}
          </Text>
        </Pressable>

        {role === 'CUSTOMER' ? (
          <Pressable
            disabled={busy}
            onPress={() => {
              setRegistering((current) => !current);
              setMessage('');
            }}
            style={styles.modeToggle}>
            <Text style={styles.modeText}>
              {registering ? 'Ya tienes cuenta? Inicia sesión' : 'Crear una cuenta de comprador'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 28,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
  },
  logo: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 32, fontWeight: '600', marginTop: 32 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 8, marginBottom: 24 },
  roleSelector: {
    flexDirection: 'row',
    backgroundColor: '#E8E5DC',
    borderRadius: 10,
    padding: 4,
  },
  roleButton: { flex: 1, alignItems: 'center', borderRadius: 7, padding: 12 },
  selectedRole: { backgroundColor: colors.surface },
  roleText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  selectedRoleText: { color: colors.text },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    color: colors.text,
    fontSize: 15,
    marginTop: 12,
    padding: 15,
  },
  message: { color: '#A43E32', fontSize: 12, lineHeight: 18, marginTop: 14 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.text,
    borderRadius: 11,
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 50,
  },
  disabled: { opacity: 0.55 },
  buttonText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  modeToggle: { alignItems: 'center', paddingVertical: 18 },
  modeText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
