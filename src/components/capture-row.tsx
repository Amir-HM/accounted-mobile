import { Image } from 'expo-image';
import { CircleAlert, CircleCheck, FileText } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Row } from '@/components/ui';
import { formatMoney, formatRelative } from '@/lib/format';
import { ProgressLine } from '@/components/motion';
import { verify } from '@/lib/checks';
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

function status(c: Capture): string {
  switch (c.state) {
    case 'queued':
      return c.error ? `Waiting to retry · ${c.error}` : 'Waiting to upload';
    case 'uploading':
      return 'Uploading…';
    case 'attaching':
      return 'Attaching to the payment…';
    case 'failed':
      return c.error ?? 'Failed';
    case 'done': {
      const v = verify(c.extraction, c.transaction);
      if (v.state === 'warn') return v.summary;
      if (c.transaction) return `Attached ${formatRelative(c.attachedAt ?? c.createdAt)}`;
      return v.state === 'unread' ? 'Archived · tap to match a payment' : `${readingLine(c.extraction)} · tap to match`;
    }
  }
}

export function CaptureRow({ capture: c, onPress, last }: { capture: Capture; onPress?: () => void; last?: boolean }) {
  const progress = useUploadProgress(c.id);
  const hex = useHex();
  const v = c.state === 'done' ? verify(c.extraction, c.transaction) : null;
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
        meta={status(c)}
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
