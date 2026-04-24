/**
 * Detect items that the "Large red platform background" (item `0x1F`)
 * will overwrite at runtime.
 *
 * The ROM routine `CreateObject_TreeBackground` sequentially writes
 * 12-tile-wide rows downward from its placement, stopping when the
 * leftmost cell of the next row is non-sky. Anything in the footprint
 * that was emitted EARLIER in the level stream gets clobbered in
 * nametable RAM. The editor force-overwrites in `renderItem` to mirror
 * that behavior — but the user has no way to see *which* items will
 * vanish in-game until they boot the ROM.
 *
 * This pass surfaces those victims so the canvas / inspector can flag
 * them with a warning. False positives are tolerable (the test below
 * doesn't simulate ground-pass tiles, so an item below the actual stop
 * row may be marked even though the red bg never reaches it). False
 * negatives are also tolerable — multi-tile items are checked by their
 * anchor cell only.
 */

import type { LevelBlock, LevelItem } from './model';

const RED_BG_ITEM_ID = 31;
const RED_BG_WIDTH = 12;

export function findRedBgOverwrites(block: LevelBlock): Set<LevelItem> {
  const victims = new Set<LevelItem>();
  const items = block.items;

  for (let i = 0; i < items.length; i++) {
    const redBg = items[i]!;
    if (redBg.kind !== 'regular') continue;
    if (redBg.itemId !== RED_BG_ITEM_ID) continue;
    if (redBg.tileX < 0 || redBg.tileY < 0) continue;

    const rx = redBg.tileX;
    const ry = redBg.tileY;

    // The runtime stop row is the first row where the leftmost column
    // (rx) holds something non-sky. Approximate it by looking for items
    // anchored at column rx with tileY > ry. Ignores ground-pass tiles
    // (which would also stop the descent) — false positives below ground
    // level are acceptable for a warning.
    let stopY = Number.POSITIVE_INFINITY;
    for (const other of items) {
      if (other === redBg) continue;
      if (other.kind !== 'regular' && other.kind !== 'entrance') continue;
      if (other.tileX !== rx) continue;
      if (other.tileY <= ry) continue;
      if (other.tileY < stopY) stopY = other.tileY;
    }

    // Only items emitted *before* the red bg in the stream get clobbered.
    // Items emitted after it overwrite the red bg (their `setItem` wins
    // by priority), so they're fine.
    for (let j = 0; j < i; j++) {
      const victim = items[j]!;
      if (victim.kind !== 'regular' && victim.kind !== 'entrance') continue;
      if (victim.tileX < 0 || victim.tileY < 0) continue;
      if (victim.tileX < rx || victim.tileX > rx + RED_BG_WIDTH - 1) continue;
      if (victim.tileY < ry || victim.tileY >= stopY) continue;
      victims.add(victim);
    }
  }

  return victims;
}
