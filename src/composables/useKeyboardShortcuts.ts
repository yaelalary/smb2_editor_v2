/**
 * Global keyboard shortcuts — Unit 8 (basic) + Unit 14 (polish).
 *
 * Registers Ctrl+Z / Ctrl+Shift+Z (Cmd on macOS) for undo/redo.
 * Skips the shortcut when the active element is a text input (so the
 * browser's native undo/redo applies to text fields instead).
 *
 * When an undo/redo affects a level slot different from the currently
 * viewed one, a transient toast shows the command label so the user
 * isn't confused by invisible state changes.
 */

import { onMounted, onUnmounted } from 'vue';
import { useHistoryStore } from '@/stores/history';
import { useRomStore } from '@/stores/rom';
import { useToast } from '@/composables/useToast';
import type { Command } from '@/commands/types';

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(): void {
  const history = useHistoryStore();
  const rom = useRomStore();
  const { show } = useToast();

  /** Show a toast if the command targeted a different slot. */
  function notifyIfOffScreen(cmd: Command | null, verb: string): void {
    if (!cmd) return;
    if (cmd.targetSlot !== undefined && cmd.targetSlot !== rom.activeSlot) {
      show(`${verb}: ${cmd.label}`);
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Don't intercept when typing in a form field.
    if (isTextInput(document.activeElement)) return;

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;

    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      const cmd = history.undo();
      notifyIfOffScreen(cmd, 'Undone');
    } else if (
      (e.key === 'z' && e.shiftKey) ||
      (e.key === 'Z' && e.shiftKey) ||
      e.key === 'y'
    ) {
      e.preventDefault();
      const cmd = history.redo();
      notifyIfOffScreen(cmd, 'Redone');
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
}
