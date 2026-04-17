/**
 * Editor UI state — Unit 11+.
 *
 * Holds cross-component editor preferences that don't belong in the ROM
 * store (which owns data) or the history store (which owns undo/redo).
 */

import { ref } from 'vue';
import { defineStore } from 'pinia';

export type EditorTool = 'tiles' | 'enemies' | 'links';

export const useEditorStore = defineStore('editor', () => {
  /** Which editing layer is active. */
  const activeTool = ref<EditorTool>('tiles');

  /** Whether enemies are visible on the canvas (overlay toggle). */
  const showEnemies = ref(true);

  return { activeTool, showEnemies };
});
