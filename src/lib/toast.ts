import { useSyncExternalStore } from 'react';

/** One transient line at the bottom of the screen: outcomes of background work, with an optional undo. */
export type Toast = { id: number; text: string; tone: 'default' | 'error'; action?: { label: string; onPress: () => void } };

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function hideToast() {
  clearTimeout(timer);
  current = null;
  emit();
}

export function showToast(text: string, tone: Toast['tone'] = 'default', action?: Toast['action']) {
  current = { id: ++seq, text, tone, action };
  emit();
  clearTimeout(timer);
  timer = setTimeout(hideToast, action ? 5000 : tone === 'error' ? 4500 : 2800);
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
