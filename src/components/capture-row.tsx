import { Image } from 'expo-image';
import { CircleAlert, CircleCheck, FileText } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Row } from '@/components/ui';
import { formatMoney, formatRelative } from '@/lib/format';
import { ProgressLine } from '@/components/motion';
import { verify } from '@/lib/checks';
import { useT, type T } from '@/lib/i18n';
import { captureFile, readingLine, useUploadProgress, type Capture } from '@/lib/queue';
import { colors, radius, useHex } from '@/lib/theme';

export function CaptureThumb({ capture, size = 36 }: { capture: Capture; size?: number }) {
  const hex = useHex();
  const box = {
    width: size,
    height: size,
    borderRadius: radius.leaf,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden' as const,
    backgroundColor: colors.muted,
  };
  if (capture.mimeType.startsWith('image/')) {
    return <Image source={captureFile(capture).uri} recyclingKey={capture.id} style={box} contentFit="cover" transition={120} />;
  }
  return (
    <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
      <FileText size={18} strokeWidth={1.5} color={hex.mutedForeground} />
    </View>
  );
}

function status(c: Capture, t: T): string {
  switch (c.state) {
    case 'queued':
      return c.error ? t('Waiting to retry · {error}', { error: c.error }) : t('Waiting to upload');
    case 'uploading':
      return t('Uploading…');
    case 'attaching':
      return t('Attaching to the payment…');
    case 'failed':
      return c.error ?? t('Failed');
    case 'done': {
      const v = verify(c.extraction, c.transaction, t.lang);
      if (v.state === 'warn') return v.summary;
      if (c.transaction) return t('Attached {when}', { when: formatRelative(c.attachedAt ?? c.createdAt, t.lang) });
      return v.state === 'unread' ? t('Archived · tap to match a payment') : t('{reading} · tap to match', { reading: readingLine(c.extraction) });
    }
  }
}

export function CaptureRow({ capture: c, onPress, last }: { capture: Capture; onPress?: () => void; last?: boolean }) {
  const progress = useUploadProgress(c.id);
  const hex = useHex();
  const t = useT();
  const v = c.state === 'done' ? verify(c.extraction, c.transaction, t.lang) : null;
  const badge =
    v?.state === 'ok' ? (
      <CircleCheck size={16} strokeWidth={1.5} color={hex.success} />
    ) : v?.state === 'warn' ? (
      <CircleAlert size={16} strokeWidth={1.5} color={hex.attn} />
    ) : null;
  return (
    <View>
      <Row
        leading={
          <View>
            <CaptureThumb capture={c} />
            {badge ? <View style={[st.badge, { backgroundColor: hex.background }]}>{badge}</View> : null}
          </View>
        }
        title={c.transaction ? c.transaction.label : c.fileName}
        meta={status(c, t)}
        value={c.transaction ? formatMoney(c.transaction.amount, c.transaction.currency) : undefined}
        valueTone={c.state === 'failed' ? 'negative' : 'muted'}
        onPress={onPress}
        last={last && progress == null}
      />
      {progress != null ? <ProgressLine value={progress} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  // The reading's verdict sits on the thumbnail's corner, on a paper disc.
  badge: { position: 'absolute', right: -6, bottom: -6, borderRadius: 999, padding: 1 },
});
