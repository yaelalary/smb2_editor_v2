/**
 * Minimal toast notification system — Unit 14.
 *
 * Provides a reactive list of toast messages that auto-dismiss after a
 * timeout. Used for transient feedback like off-screen undo notifications.
 */

import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
}

let nextId = 0;
const toasts = ref<Toast[]>([]);

const DISMISS_MS = 3000;

export function useToast() {
  function show(message: string): void {
    const id = nextId++;
    toasts.value.push({ id, message });
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, DISMISS_MS);
  }

  return { toasts, show };
}
