import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { ActionSheetIOS, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { ApiError, listCompanies, type Company } from '@/lib/api';
import { normalizeServerUrl, saveConnection } from '@/lib/connection';
import { signInWithAccounted } from '@/lib/oauth';
import { colors, fonts, radius, space, type, useHex } from '@/lib/theme';

const SCOPES = 'companies:read, documents:read/write, transactions:read/write, reports:read, bookkeeping:write, pending_operations:read/approve';
// A build may preset its own server (app.json → extra.defaultServer).
const DEFAULT_SERVER = (Constants.expoConfig?.extra?.defaultServer as string | undefined) ?? '';

function chooseCompany(companies: Company[]): Promise<Company | null> {
  if (companies.length === 1) return Promise.resolve(companies[0]);
  return new Promise((resolve) =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Which company?', options: [...companies.map((c) => c.name), 'Cancel'], cancelButtonIndex: companies.length },
      (i) => resolve(i < companies.length ? companies[i] : null),
    ),
  );
}

/** One-way door: once connected, the root stack swaps this route out (Stack.Protected). */
export default function Setup() {
  const hex = useHex();
  const server = useRef(DEFAULT_SERVER);
  const key = useRef('');
  const [useKey, setUseKey] = useState(false);
  const [busy, setBusy] = useState<'signin' | 'key' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function serverUrlOrError(): string | null {
    try {
      return normalizeServerUrl(server.current);
    } catch {
      setError('Enter the address you use to open Accounted, for example accounted.example.com.');
      return null;
    }
  }

  async function finish(serverUrl: string, apiKey: string) {
    const companies = await listCompanies({ serverUrl, apiKey });
    if (companies.length === 0) throw new ApiError(403, 'NO_COMPANY', 'This account has no company the app can read.');
    const company = await chooseCompany(companies);
    if (!company) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await saveConnection({ serverUrl, apiKey, companyId: company.id, companyName: company.name });
  }

  function fail(e: unknown) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (e instanceof ApiError && e.code === 'INSUFFICIENT_SCOPE') setError(`Access is missing a permission. The app needs: ${SCOPES}.`);
    else if (e instanceof ApiError && e.status === 401)
      setError('The server did not accept the key. Check that it is copied in full and not revoked.');
    else setError(e instanceof Error ? e.message : 'Could not connect.');
  }

  async function signIn() {
    setError(null);
    const serverUrl = serverUrlOrError();
    if (!serverUrl) return;
    setBusy('signin');
    try {
      const apiKey = await signInWithAccounted(serverUrl);
      if (apiKey) await finish(serverUrl, apiKey);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function connectWithKey() {
    setError(null);
    const serverUrl = serverUrlOrError();
    if (!serverUrl) return;
    const apiKey = key.current.trim();
    if (!apiKey.startsWith('gnubok_sk_')) {
      setError('That does not look like an Accounted API key (it starts with gnubok_sk_).');
      return;
    }
    setBusy('key');
    try {
      await finish(serverUrl, apiKey);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.frame }}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={s.wordmark} accessibilityRole="header">
          accounted
        </Text>

        <View style={s.card}>
          <Field label="Server">
            <TextInput
              style={s.input}
              defaultValue={DEFAULT_SERVER}
              placeholder="accounted.example.com"
              placeholderTextColor={hex.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onChangeText={(t) => (server.current = t)}
              onSubmitEditing={useKey ? undefined : signIn}
            />
          </Field>
          {useKey ? (
            <Field label="API key">
              <TextInput
                style={s.input}
                placeholder="gnubok_sk_…"
                placeholderTextColor={hex.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                autoFocus
                onChangeText={(t) => (key.current = t)}
                onSubmitEditing={connectWithKey}
              />
            </Field>
          ) : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          {useKey ? (
            <Button title="Connect" onPress={connectWithKey} busy={busy === 'key'} disabled={!!busy} />
          ) : (
            <Button title="Sign in with Accounted" onPress={signIn} busy={busy === 'signin'} disabled={!!busy} />
          )}
        </View>

        <View style={{ alignItems: 'center', gap: space(4) }}>
          <Text style={[type.meta, { textAlign: 'center', lineHeight: 18 }]}>
            {useKey
              ? `Create a key in Accounted under Settings → API with: ${SCOPES}. It stays in this iPhone’s Keychain.`
              : 'You sign in on your Accounted server and approve access for this iPhone: receipts, bank transactions and reports.'}
          </Text>
          <Button
            variant="link"
            title={useKey ? 'Sign in with Accounted instead' : 'Use an API key instead'}
            onPress={() => {
              setError(null);
              setUseKey(!useKey);
            }}
            disabled={!!busy}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space(2) }}>
      <Text style={type.bodyMedium}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', padding: space(4), gap: space(8) },
  wordmark: { fontFamily: fonts.display, fontSize: 60, lineHeight: 70, color: colors.foreground, textAlign: 'center', letterSpacing: -1.5 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.panel,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(6),
    gap: space(4),
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    minHeight: 46,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.foreground,
  },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.destructive },
});
