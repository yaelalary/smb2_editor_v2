/**
 * Global keyboard shortcuts — Unit 8 (basic) + Unit 14 (polish).
 *
 * Registers Ctrl+Z / Ctrl+Shift+Z (Cmd on macOS) for undo/redo.
 * Skips the shortcut when the active element is a text input (so the
 * browser's native undo/redo applies to text fields instead).
 */

import { onMounted, onUnmounted } from 'vue';
import { useHistoryStore } from '@/stores/history';

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(): void {
  const history = useHistoryStore();

  function onKeyDown(e: KeyboardEvent): void {
    // Don't intercept when typing in a form field.
    if (isTextInput(document.activeElement)) return;

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;

    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      history.undo();
    } else if (
      (e.key === 'z' && e.shiftKey) ||
      (e.key === 'Z' && e.shiftKey) ||
      e.key === 'y'
    ) {
      e.preventDefault();
      history.redo();
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
}
