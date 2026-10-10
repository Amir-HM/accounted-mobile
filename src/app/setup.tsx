import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { ActionSheetIOS, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, styles as ui } from '@/components/ui';
import { ApiError, listCompanies, type Company } from '@/lib/api';
import { normalizeServerUrl, saveConnection } from '@/lib/connection';
import { colors, radius, space } from '@/lib/theme';

const SCOPES = 'companies:read, documents:read/write, transactions:read/write, reports:read';

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
  const server = useRef('');
  const key = useRef('');
  const keyInput = useRef<TextInput>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(server.current);
    } catch {
      setError('Enter the address you use to open Accounted, for example accounted.example.com.');
      return;
    }
    const apiKey = key.current.trim();
    if (!apiKey.startsWith('gnubok_sk_')) {
      setError('That does not look like an Accounted API key (it starts with gnubok_sk_).');
      return;
    }
    setBusy(true);
    try {
      const companies = await listCompanies({ serverUrl, apiKey });
      if (companies.length === 0) throw new ApiError(403, 'NO_COMPANY', 'The key has no company it can read.');
      const company = await chooseCompany(companies);
      if (!company) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await saveConnection({ serverUrl, apiKey, companyId: company.id, companyName: company.name });
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_SCOPE') setError(`The key is missing a permission. It needs: ${SCOPES}.`);
      else if (e instanceof ApiError && e.status === 401) setError('The server did not accept the key. Check that it is copied in full and not revoked.');
      else setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ gap: space(2) }}>
            <Text style={s.title}>Connect to Accounted</Text>
            <Text style={s.lead}>Snap receipts on the go and match them to your bank transactions.</Text>
          </View>

          <View style={{ gap: space(3) }}>
            <Field label="Server address">
              <TextInput
                style={s.input}
                placeholder="accounted.example.com"
                placeholderTextColor={colors.tertiaryLabel}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="next"
                onChangeText={(t) => (server.current = t)}
                onSubmitEditing={() => keyInput.current?.focus()}
              />
            </Field>
            <Field label="API key">
              <TextInput
                ref={keyInput}
                style={s.input}
                placeholder="gnubok_sk_…"
                placeholderTextColor={colors.tertiaryLabel}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                textContentType="password"
                returnKeyType="go"
                onChangeText={(t) => (key.current = t)}
                onSubmitEditing={connect}
              />
            </Field>
            {error ? <Text style={s.error}>{error}</Text> : null}
          </View>

          <Text style={ui.sectionFooter}>
            Create a key in Accounted on the web under Settings → API. Give it these permissions: {SCOPES}. The key is kept in this
            iPhone's Keychain and never leaves the device except to your server.
          </Text>

          <Button title="Connect" onPress={connect} busy={busy} />
        </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space(1.5) }}>
      <Text style={ui.sectionTitle}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  content: { padding: space(5), paddingTop: space(12), gap: space(8) },
  title: { fontSize: 34, fontWeight: '700', color: colors.label, letterSpacing: 0.4 },
  lead: { fontSize: 17, color: colors.secondaryLabel, lineHeight: 23 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    paddingHorizontal: space(4),
    minHeight: 50,
    fontSize: 17,
    color: colors.label,
  },
  error: { fontSize: 15, color: colors.negative, paddingHorizontal: space(4), lineHeight: 20 },
});
