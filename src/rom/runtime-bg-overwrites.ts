/**
 * Detect items that runtime-composed background objects will overwrite.
 *
 * Two such objects exist in vanilla SMB2 — both dispatched from the
 * `CreateObjects_10` table in `Xkeeper0/smb2 src/prg-6-7.asm`:
 *
 *   - item `0x1F` (Large red platform background) — 12-tile-wide rows
 *     extending downward
 *   - item `0x17` (Pyramid) — symmetric triangle, row N is `2N+2` wide
 *     and shifts one column left per descent
 *
 * Both walk down with a sky check on the leftmost cell of each row.
 * Earlier-stream items in the footprint get clobbered when the ROM
 * sequentially writes nametable RAM. The editor force-overwrites in
 * `renderItem` to mirror that. This pass surfaces the same victims for
 * the canvas / inspector to flag.
 *
 * Implementation: replay the actual rendering pipeline (ground pass,
 * then items in stream order) on a private grid. Around each bg item,
 * snapshot the grid, render, and compare — cells the bg actually wrote
 * to are exactly the cells that newly carry its `regularId`. Any
 * earlier-stream item anchored on one of those cells is a victim.
 *
 * This matches what the ROM does: the routine's sky-check stops the
 * descent at ground, walls, and earlier objects — same as the live
 * editor canvas — so the warning set never overshoots.
 */

import type { LevelBlock, LevelItem } from './model';
import { CanvasGrid } from './canvas-grid';
import { computeGroundSegments, groundPass } from './ground-pass';
import { renderItem } from './item-renderer';
import { levelDimensions } from './level-layout';

const RED_BG_ITEM_ID = 31;
const PYRAMID_ITEM_ID = 23;

function isRuntimeBg(it: LevelItem): boolean {
  return it.kind === 'regular'
    && (it.itemId === RED_BG_ITEM_ID || it.itemId === PYRAMID_ITEM_ID);
}

function isPositioned(it: LevelItem): boolean {
  return (
    (it.kind === 'regular' || it.kind === 'entrance')
    && it.tileX >= 0
    && it.tileY >= 0
  );
}

export function findRuntimeBgOverwrites(
  block: LevelBlock,
  rom: Uint8Array,
  slot: number,
  fx: number,
  gfx: number,
): Set<LevelItem> {
  const victims = new Set<LevelItem>();

  // Skip the simulation entirely when there's no bg item.
  let anyBg = false;
  for (const it of block.items) {
    if (isRuntimeBg(it)) { anyBg = true; break; }
  }
  if (!anyBg) return victims;

  const isH = block.header.direction === 1;
  const world = Math.floor(slot / 30);
  const { widthTiles, heightTiles } = levelDimensions(block);

  const grid = new CanvasGrid(widthTiles, heightTiles, fx, gfx, isH);
  const segments = computeGroundSegments(block);
  groundPass(grid, rom, world, segments);

  // Pre-index positioned items by cell, plus item→stream-index, so the
  // inner victim lookup is O(1) per cell instead of O(items × indexOf).
  const itemsAtCell = new Map<number, LevelItem[]>();
  const indexOfItem = new Map<LevelItem, number>();
  const cellKey = (x: number, y: number): number => y * 1024 + x;
  for (let k = 0; k < block.items.length; k++) {
    const it = block.items[k]!;
    indexOfItem.set(it, k);
    if (!isPositioned(it)) continue;
    const ck = cellKey(it.tileX, it.tileY);
    let bucket = itemsAtCell.get(ck);
    if (!bucket) { bucket = []; itemsAtCell.set(ck, bucket); }
    bucket.push(it);
  }

  for (let i = 0; i < block.items.length; i++) {
    const item = block.items[i]!;
    if (!isRuntimeBg(item)) {
      renderItem(grid, item, rom, slot, block.header);
      continue;
    }

    // Snapshot, render, scan for cells the bg just wrote to. We compare
    // by `regularId`: ground cells carry `regularId=0`, other items carry
    // their own `regularId`, so a transition INTO `regularId === bg.itemId`
    // is unambiguously the bg's write.
    const before = grid.clone();
    renderItem(grid, item, rom, slot, block.header);

    for (let y = 0; y < heightTiles; y++) {
      for (let x = 0; x < widthTiles; x++) {
        const after = grid.getItem(x, y);
        if (after.regularId !== item.itemId) continue;
        const wasBefore = before.getItem(x, y);
        if (wasBefore.regularId === item.itemId
          && wasBefore.tileId === after.tileId) continue;
        const bucket = itemsAtCell.get(cellKey(x, y));
        if (!bucket) continue;
        for (const v of bucket) {
          // Only earlier-stream items are runtime victims; later items
          // overwrite the bg via their normal priority-aware setItem.
          if ((indexOfItem.get(v) ?? -1) < i) victims.add(v);
        }
      }
    }
  }

  return victims;
}
