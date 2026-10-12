import * as LocalAuthentication from 'expo-local-authentication';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Button } from '@/components/ui';
import { tr, useT } from '@/lib/i18n';
import { getPref, usePref } from '@/lib/prefs';
import { colors, fonts, motion, space, type } from '@/lib/theme';

const RELOCK_AFTER_MS = 60_000;
// Screens iOS presents natively above everything, including this cover: a
// receipt, the recent-photos grid. They are closed when the app is left.
const MODAL = /^\/(viewer\/|add|assign\/|prime)/;

/**
 * Two privacy layers over the whole app:
 * - the app-switcher cover: when the app leaves the foreground the screen is
 *   covered, so the snapshot iOS keeps shows no amounts;
 * - the Face ID lock: after a minute away the app asks for Face ID (or the
 *   passcode) before showing anything.
 */
export function LockGate({ enabled }: { enabled: boolean }) {
  const t = useT();
  const lock = usePref('faceIdLock');
  const cover = usePref('privacyCover');
  const [away, setAway] = useState(false);
  const [locked, setLocked] = useState(() => enabled && getPref('faceIdLock'));
  const leftAt = useRef<number | null>(null);
  const prompting = useRef(false);
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  async function unlock() {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: tr('Unlock Accounted'), disableDeviceFallback: false });
      if (r.success) setLocked(false);
    } finally {
      prompting.current = false;
    }
  }

  useEffect(() => {
    if (locked && AppState.currentState === 'active') void unlock();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        setAway(false);
        if (enabled && getPref('faceIdLock') && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) {
          setLocked(true);
          void unlock();
        }
        leftAt.current = null;
      } else {
        setAway(true);
        if (s === 'background' && leftAt.current == null) leftAt.current = Date.now();
        if (s === 'background' && (getPref('privacyCover') || getPref('faceIdLock')) && MODAL.test(path.current) && router.canGoBack()) {
          router.back();
        }
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;
  const showCover = (away && (cover || lock)) || (locked && lock);
  if (!showCover) return null;
  return (
    <Animated.View exiting={FadeOut.duration(motion.fast)} style={st.cover}>
      <Text style={st.wordmark}>accounted</Text>
      {locked && lock && !away ? (
        <View style={{ gap: space(3), alignItems: 'center' }}>
          <Text style={type.meta}>{t('Locked')}</Text>
          <Button title={t('Unlock')} onPress={unlock} style={{ minWidth: 180 }} />
        </View>
      ) : null}
    </Animated.View>
  );
}

const st = StyleSheet.create({
  cover: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.frame,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(8),
    zIndex: 100,
  },
  wordmark: { fontFamily: fonts.display, fontSize: 52, color: colors.foreground, letterSpacing: -1.3 },
});
