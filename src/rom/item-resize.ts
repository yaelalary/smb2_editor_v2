/**
 * Resize helpers for extended items (rawId >= 0x30).
 *
 * In SMB2 the low nibble of an extended item's id byte encodes its size
 * (`rawId & 0x0F`). The high nibble (shifted) gives the vid:
 *   (rawId - 0x30) / 0x10 → 0..12
 *
 * Which vids are sizeable, and in which direction, mirrors the dispatch
 * in `item-renderer.ts::renderItem`:
 *   - vid 0-4, 10, 11 → horizontal extent (handle right)
 *   - vid 5-7         → vertical extent   (handle bottom)
 *   - vid 8, 9, 12    → massive (width only; handle right — height is fixed)
 */

import type { LevelItem } from './model';

export type ResizeAxis = 'horizontal' | 'vertical';

/** True when the item's low nibble encodes a user-controllable size. */
export function isResizable(rawId: number): boolean {
  if (rawId < 0x30) return false;
  const vid = Math.floor((rawId - 0x30) / 0x10);
  return vid >= 0 && vid <= 12;
}

/** Resize direction — axis along which the end handle moves. */
export function resizeAxis(rawId: number): ResizeAxis {
  const vid = Math.floor((rawId - 0x30) / 0x10);
  if (vid >= 5 && vid <= 7) return 'vertical';
  return 'horizontal';
}

/** Current size in the low nibble (0..15). Display length = size + 1. */
export function itemSize(rawId: number): number {
  return rawId & 0x0f;
}

/** Build a new id byte with the same vid but a different size. */
export function withSize(rawId: number, newSize: number): number {
  return (rawId & 0xf0) | (newSize & 0x0f);
}

/** Tile position of the resize handle — at the far end of the footprint. */
export function handlePosition(item: LevelItem): { x: number; y: number } {
  const size = itemSize(item.itemId);
  if (resizeAxis(item.itemId) === 'horizontal') {
    return { x: item.tileX + size, y: item.tileY };
  }
  return { x: item.tileX, y: item.tileY + size };
}

/** Target size based on where the user dragged relative to the anchor. */
export function sizeFromHover(
  item: LevelItem,
  hoverX: number,
  hoverY: number,
): number {
  const delta =
    resizeAxis(item.itemId) === 'horizontal'
      ? hoverX - item.tileX
      : hoverY - item.tileY;
  return Math.max(0, Math.min(15, delta));
}
