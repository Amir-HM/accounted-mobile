import { useSyncExternalStore } from 'react';

/** One transient line at the bottom of the screen: outcomes of background work. */
export type Toast = { id: number; text: string; tone: 'default' | 'error' };

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(text: string, tone: Toast['tone'] = 'default') {
  current = { id: ++seq, text, tone };
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    emit();
  }, tone === 'error' ? 4500 : 2800);
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
