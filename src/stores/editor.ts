/**
 * Editor UI state — Unit 11+.
 *
 * Holds cross-component editor preferences that don't belong in the ROM
 * store (which owns data) or the history store (which owns undo/redo).
 */

import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { LevelItem } from '@/rom/model';

export type EditorTool = 'tiles' | 'enemies' | 'ground' | 'links';

/**
 * Ground segment selection — either the header (sentinel) or a
 * reference to a stream `groundSet` LevelItem. Shared between
 * `GroundPanel` (list UI) and `LevelCanvas` (click-to-select).
 */
export type GroundSelection = 'header' | LevelItem | null;

export const useEditorStore = defineStore('editor', () => {
  /** Which editing layer is active. */
  const activeTool = ref<EditorTool>('tiles');

  /** Whether enemies are visible on the canvas (overlay toggle). */
  const showEnemies = ref(true);

  /**
   * Currently-selected ground segment. `shallowRef` preserves raw
   * identity of the LevelItem reference (same reasoning as the tile /
   * enemy selections in LevelCanvas).
   */
  const selectedGroundSegment = shallowRef<GroundSelection>('header');

  return { activeTool, showEnemies, selectedGroundSegment };
});
