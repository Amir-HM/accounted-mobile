import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library/legacy';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, FolderOpen, Images, ScanLine, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Button, Segmented } from '@/components/ui';
import { captureAndQueue, type CaptureMethod } from '@/lib/capture';
import { formatMoney } from '@/lib/format';
import { enqueue, type Capture } from '@/lib/queue';
import { showToast } from '@/lib/toast';
import { colors, fonts, radius, space, type, useHex } from '@/lib/theme';

const COLS = 3;
const GAP = 4;

/**
 * "Add a receipt": the three ways in (scan, photo library, files) and the
 * latest photos and screenshots right here, because a receipt is usually the
 * last thing you photographed or screenshotted. Opened for a payment it adds
 * one receipt to that payment; opened bare it can add several, each matched
 * later (a payment is suggested from the reading).
 */
export default function AddReceipt() {
  const p = useLocalSearchParams<{ txId?: string; label?: string; amount?: string; currency?: string; date?: string }>();
  const tx: Capture['transaction'] | undefined = p.txId
    ? { id: p.txId, label: p.label ?? '', amount: Number(p.amount), currency: p.currency ?? 'SEK', date: p.date ?? '' }
    : undefined;
  const hex = useHex();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - space(4) * 2 - GAP * (COLS - 1)) / COLS);

  const [perm, setPerm] = useState<MediaLibrary.PermissionResponse | null>(null);
  const [filter, setFilter] = useState<'recent' | 'screenshots'>('recent');
  const [assets, setAssets] = useState<MediaLibrary.Asset[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (f: typeof filter) => {
    const r = await MediaLibrary.getAssetsAsync({
      first: 60,
      mediaType: MediaLibrary.MediaType.photo,
      sortBy: [[MediaLibrary.SortBy.creationTime, false]],
    });
    const list = f === 'screenshots' ? r.assets.filter((a) => a.mediaSubtypes?.includes('screenshot')) : r.assets;
    setAssets(list.slice(0, 30));
  }, []);

  useEffect(() => {
    MediaLibrary.getPermissionsAsync().then((s) => {
      setPerm(s);
      if (s.granted) void load(filter);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function allow() {
    const s = await MediaLibrary.requestPermissionsAsync();
    setPerm(s);
    if (s.granted) void load(filter);
    else if (!s.canAskAgain) Linking.openSettings();
  }

  async function via(method: CaptureMethod) {
    try {
      const c = await captureAndQueue(method, tx);
      if (c) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      }
    } catch (e) {
      Alert.alert('Could not add the receipt', e instanceof Error ? e.message : String(e));
    }
  }

  function toggle(id: string) {
    Haptics.selectionAsync();
    setPicked((cur) => (tx ? (cur[0] === id ? [] : [id]) : cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function addPicked() {
    if (!assets) return;
    setBusy(true);
    try {
      for (const id of picked) {
        const a = assets.find((x) => x.id === id);
        if (!a) continue;
        const info = await MediaLibrary.getAssetInfoAsync(a);
        let uri = info.localUri ?? a.uri;
        let name = a.filename || `photo-${a.creationTime}.jpg`;
        // HEIC and friends become a JPEG the archive and the reader both take.
        if (!/\.(jpe?g|png)$/i.test(name)) {
          const img = await ImageManipulator.manipulate(uri).renderAsync();
          const saved = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
          uri = saved.uri;
          name = name.replace(/\.[^.]+$/, '') + '.jpg';
        }
        await enqueue({ uri, fileName: name, mimeType: name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', source: 'file_upload', transaction: tx });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (picked.length > 1) showToast(`${picked.length} receipts added`);
      router.back();
    } catch (e) {
      Alert.alert('Could not add the receipt', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space(4), paddingBottom: space(10), gap: space(4) }}>
        <View style={{ gap: 2 }}>
          <Text style={[type.display, { fontSize: 24, lineHeight: 30 }]}>Add a receipt</Text>
          {tx ? <Text style={type.meta}>{`For ${tx.label} · ${formatMoney(tx.amount, tx.currency)}`}</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Way icon={ScanLine} label="Scan" onPress={() => via('scan')} primary />
          <Way icon={Images} label="Photos" onPress={() => via('photo')} />
          <Way icon={FolderOpen} label="Files" onPress={() => via('file')} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space(2) }}>
          <Text style={type.label}>Recent</Text>
          {perm?.granted ? (
            <Segmented
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setPicked([]);
                void load(f);
              }}
              options={[
                { key: 'recent', label: 'Photos' },
                { key: 'screenshots', label: 'Screenshots' },
              ]}
            />
          ) : null}
        </View>

        {picked.length ? (
          <Button title={picked.length > 1 ? `Add ${picked.length} receipts` : 'Add receipt'} onPress={addPicked} busy={busy} />
        ) : null}

        {perm && !perm.granted ? (
          <View style={st.allow}>
            <Text style={[type.body, { textAlign: 'center' }]}>Show your latest photos and screenshots here</Text>
            <Text style={[type.meta, { textAlign: 'center' }]}>Most receipts are the last thing you photographed.</Text>
            <Button title={perm.canAskAgain ? 'Allow access' : 'Open Settings'} variant="outline" size="sm" onPress={allow} style={{ marginTop: space(2) }} />
          </View>
        ) : assets && assets.length === 0 ? (
          <Text style={[type.meta, { paddingVertical: space(6), textAlign: 'center' }]}>
            {filter === 'screenshots' ? 'No recent screenshots.' : 'No photos yet.'}
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
            {(assets ?? Array.from({ length: 9 }, (_, i) => ({ id: `s${i}` }) as MediaLibrary.Asset)).map((a) => {
              const on = picked.includes(a.id);
              return (
                <Pressable
                  key={a.id}
                  disabled={!assets}
                  onPress={() => toggle(a.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{ width: tile, height: tile }}>
                  {a.uri ? (
                    <Image source={a.uri} recyclingKey={a.id} style={st.thumb} contentFit="cover" transition={120} />
                  ) : (
                    <View style={[st.thumb, { backgroundColor: colors.muted }]} />
                  )}
                  {on ? (
                    <View style={st.selected}>
                      <View style={st.check}>
                        <Check size={14} strokeWidth={2.5} color={hex.onPrimary} />
                      </View>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
        {perm?.accessPrivileges === 'limited' ? (
          <Text style={type.meta}>
            Showing only the photos you shared with Accounted.{' '}
            <Text style={{ textDecorationLine: 'underline', color: colors.foreground }} onPress={() => Linking.openSettings()}>
              Change
            </Text>
          </Text>
        ) : null}
    </ScrollView>
  );
}

function Way({ icon: Icon, label, onPress, primary }: { icon: LucideIcon; label: string; onPress: () => void; primary?: boolean }) {
  const hex = useHex();
  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={() => Haptics.selectionAsync()}
      onPress={onPress}
      style={({ pressed }) => [st.way, primary && { backgroundColor: colors.primary, borderColor: colors.primary }, pressed && { opacity: 0.8 }]}>
      <Icon size={22} strokeWidth={1.5} color={primary ? hex.onPrimary : hex.foreground} />
      <Text style={[st.wayText, primary && { color: colors.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  way: {
    flex: 1,
    height: 84,
    borderRadius: radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
  },
  wayText: { fontFamily: fonts.medium, fontSize: 14, color: colors.foreground },
  thumb: { width: '100%', height: '100%', borderRadius: radius.leaf },
  selected: {
    ...{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    borderRadius: radius.leaf,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'flex-end',
    padding: 6,
  },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  allow: {
    alignItems: 'center',
    gap: space(1),
    paddingVertical: space(8),
    borderRadius: radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
