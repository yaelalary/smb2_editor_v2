/**
 * Undo/redo history store — Unit 8.
 *
 * Global undo scope (one stack for all edits across all levels). When
 * a command targets a slot different from the currently-viewed one, the
 * UI should show a transient notification (implemented in Unit 14).
 *
 * Stack has no hard cap (see AGENTS.md / plan discussion). Typical
 * sessions produce < 1 MB of command objects.
 */

import { ref, computed } from 'vue';
import { defineStore } from 'pinia';
import type { Command } from '@/commands/types';

export const useHistoryStore = defineStore('history', () => {
  const undoStack = ref<Command[]>([]);
  const redoStack = ref<Command[]>([]);

  /** Revision counter — bumped on every execute/undo/redo so watchers
   *  on the ROM store can trigger re-renders. */
  const revision = ref(0);

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  const lastUndoLabel = computed(
    () => undoStack.value[undoStack.value.length - 1]?.label ?? null,
  );
  const lastRedoLabel = computed(
    () => redoStack.value[redoStack.value.length - 1]?.label ?? null,
  );

  /**
   * Execute a command: apply it, push onto undo stack, clear redo stack.
   * This is the ONLY entry point for model mutations.
   */
  function execute(cmd: Command): void {
    cmd.execute();
    undoStack.value.push(cmd);
    redoStack.value = [];
    revision.value++;
  }

  /** Undo the most recent command. */
  function undo(): Command | null {
    const cmd = undoStack.value.pop();
    if (!cmd) return null;
    cmd.undo();
    redoStack.value.push(cmd);
    revision.value++;
    return cmd;
  }

  /** Redo the most recently undone command. */
  function redo(): Command | null {
    const cmd = redoStack.value.pop();
    if (!cmd) return null;
    cmd.execute();
    undoStack.value.push(cmd);
    revision.value++;
    return cmd;
  }

  /** Clear all history (called on ROM unload). */
  function clear(): void {
    undoStack.value = [];
    redoStack.value = [];
    revision.value = 0;
  }

  return {
    undoStack,
    redoStack,
    revision,
    canUndo,
    canRedo,
    lastUndoLabel,
    lastRedoLabel,
    execute,
    undo,
    redo,
    clear,
  };
});
