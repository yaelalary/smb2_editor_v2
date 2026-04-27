/**
 * Editor UI state — Unit 11+.
 *
 * Holds cross-component editor preferences that don't belong in the ROM
 * store (which owns data) or the history store (which owns undo/redo).
 */

import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { EnemyItem, LevelItem } from '@/rom/model';

/**
 * Selected enemy on the canvas. The page index is needed alongside the
 * `EnemyItem` because enemies live in a per-page list — without the page
 * we can't compute the absolute (x, y) position.
 */
export interface EnemySelection {
  readonly enemy: EnemyItem;
  readonly pageIndex: number;
}

export type EditorTool = 'tiles' | 'enemies' | 'ground';

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

  /**
   * Currently-selected item(s) on the canvas. Shared with the right-
   * side Item Inspector so it can render the destination picker and
   * other per-item properties. `shallowRef` preserves reference
   * identity — downstream code (selection rings, move commands) relies
   * on `===` comparisons against LevelItem instances.
   *
   * The canvas watches this ref to refresh the selection ring AND to
   * scroll the first selected item into view (no-op if already visible).
   */
  const selectedItems = shallowRef<LevelItem[]>([]);

  /**
   * Currently-selected enemies on the canvas. Same `shallowRef` reasoning
   * as `selectedItems` — the canvas, the EnemyLibrary highlight, and the
   * PropertiesPanel all use reference identity to render selection state
   * and per-enemy properties.
   */
  const selectedEnemies = shallowRef<EnemySelection[]>([]);

  return { activeTool, showEnemies, selectedGroundSegment, selectedItems, selectedEnemies };
});
