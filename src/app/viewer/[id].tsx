import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { X } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { useT } from '@/lib/i18n';
import { captureFile, useCaptures } from '@/lib/queue';
import { colors, useHex } from '@/lib/theme';

/** The receipt itself, full screen: pinch to zoom on a photo, native PDF rendering for files. */
export default function Viewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useCaptures().find((x) => x.id === id);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hex = useHex();
  const t = useT();
  if (!c) return null;
  const uri = captureFile(c).uri;

  return (
    <View style={{ flex: 1, backgroundColor: colors.frame }}>
      {c.mimeType.startsWith('image/') ? (
        <ScrollView
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ width, height }}>
          <Image source={uri} style={{ width, height }} contentFit="contain" />
        </ScrollView>
      ) : (
        <WebView
          source={{ uri }}
          // The receipt file only: no scripts, and a link inside a PDF never navigates the viewer.
          originWhitelist={['file://*']}
          javaScriptEnabled={false}
          onShouldStartLoadWithRequest={(r) => r.url === uri}
          allowingReadAccessToURL={uri}
          style={{ flex: 1, marginTop: insets.top + 52, backgroundColor: 'transparent' }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Close')}
        onPress={() => router.back()}
        hitSlop={12}
        style={[st.close, { top: insets.top + 8 }]}>
        <X size={20} strokeWidth={1.5} color={hex.foreground} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  close: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
