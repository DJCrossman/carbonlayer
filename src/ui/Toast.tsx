// Bottom-centre transient message: render <ToastHost /> once per page, call showToast() from anywhere.
import { useSyncExternalStore } from 'react';
import './ui.css';

export function ToastHost() {
  const toast = useSyncExternalStore(subscribeToToasts, () => current);
  if (!toast) return null;
  return (
    <div className="gg-toast-host" role="status" aria-live="polite">
      <div key={toast.id} className={`gg-toast gg-toast--${toast.tone}`}>
        {toast.message}
      </div>
    </div>
  );
}

export function showToast(message: string, tone: 'default' | 'danger' = 'default'): void {
  current = { id: (current?.id ?? 0) + 1, message, tone };
  for (const notify of listeners) notify();
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    current = null;
    for (const notify of listeners) notify();
  }, 2400);
}

let current: { id: number; message: string; tone: 'default' | 'danger' } | null = null;
const listeners = new Set<() => void>();
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function subscribeToToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
