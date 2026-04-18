/**
 * Ground pass — port of `DrawGroundEx` (clvldraw_worker.cpp:611).
 *
 * Walks the item stream to produce a list of ground segments (stream of
 * groundSet items with the current groundType), then writes every cell
 * of the canvas grid by extracting 2-bit bitsets from each segment's
 * ROM-read groundSet DWORD. This mirrors the C++ initial-draw path:
 *   - segment 0 is the level header's initial ground (skipped only if
 *     gSetIdx === 0x1F, per DrawGroundEx line 632)
 *   - each subsequent groundSet item overrides the canvas from startPos
 *     to the end of the axis
 *   - bitset=0 → SetCanvasNullItem (hole); bitset!=0 → SetCanvasItem with
 *     type=bitset so SetCanvasItem's priority branch treats the cell as
 *     ground for later items
 */

import type { LevelBlock } from './model';
import type { CanvasGrid } from './canvas-grid';
import { getBgSet, getBgTile } from './tile-reader';

export interface GroundSegment {
  startPos: number;
  groundSet: number;
  groundType: number;
}

/**
 * Walk the item stream and collect ground segments. Mirrors the C++
 * cneseditor_loader.cpp:73-99 ground-tracking logic, adapted for our
 * LevelItem stream shape. The first segment is always the header's
 * initial ground at startPos=0.
 */
export function computeGroundSegments(b: LevelBlock): GroundSegment[] {
  const isH = b.header.direction === 1;
  const segments: GroundSegment[] = [];
  let currentGroundType = b.header.groundType;
  segments.push({ startPos: 0, groundSet: b.header.groundSet, groundType: currentGroundType });

  let deltaX = 0;
  let deltaY = 0;
  let lastGroundPos = 0;

  for (const item of b.items) {
    switch (item.kind) {
      case 'skipper': {
        const lowNibble = (item.sourceBytes[0] ?? 0) & 0x0f;
        deltaY = 0;
        deltaX += (lowNibble - 1) * 0x10;
        break;
      }
      case 'backToStart':
        deltaX = 0;
        deltaY = 0;
        break;
      case 'regular':
      case 'entrance': {
        const byte0 = item.sourceBytes[0] ?? 0;
        const iy = (byte0 >> 4) & 0x0f;
        deltaY += iy;
        if (deltaY >= 0x0f) {
          deltaY = (deltaY + 1) % 16;
          deltaX += 0x10;
        }
        break;
      }
      case 'groundSet': {
        const byte0 = item.sourceBytes[0] ?? 0;
        const byte1 = item.sourceBytes[1] ?? 0;
        const gSet = byte1 & 0x1f;
        const reserved = byte0 & 0x0f;
        let pos: number;
        if (isH) {
          pos = deltaX + 8 * reserved + Math.floor(byte1 / 0x20);
          if (pos <= lastGroundPos) pos = lastGroundPos + 1;
        } else {
          pos = 0x0f * Math.floor(deltaX / 0x10) + 8 * reserved + Math.floor(byte1 / 0x20);
          if (pos <= lastGroundPos) pos = lastGroundPos + 1;
        }
        lastGroundPos = pos;
        segments.push({ startPos: pos, groundSet: gSet, groundType: currentGroundType });
        break;
      }
      case 'groundType':
        currentGroundType = (item.sourceBytes[1] ?? 0) & 0x07;
        break;
    }
  }
  return segments;
}

/**
 * Apply every ground segment to the canvas grid. Writes are unconditional
 * between segments (later segments override earlier ones); the grid is
 * expected to be empty when this runs, so the priority branch never
 * fires during this pass. `world` is derived from the active slot by the
 * caller (Math.floor(slot / 30)) so this module stays decoupled from the
 * Pinia store.
 *
 * Mirrors DrawGroundEx line 611 for both direction branches.
 */
export function groundPass(
  grid: CanvasGrid,
  rom: Uint8Array,
  world: number,
  segments: readonly GroundSegment[],
): void {
  const isH = grid.isH;

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]!;
    const gSetIdx = seg.groundSet & 0x1f;
    // DrawGroundEx line 632: skip only the initial-bg segment when 0x1F.
    if (gSetIdx === 0x1f && segIdx === 0) continue;

    const dwGroundSet = getBgSet(rom, gSetIdx, isH);
    const gType = seg.groundType & 0x07;

    if (isH) {
      for (let cx = seg.startPos; cx < grid.width; cx++) {
        let bit = 30;
        for (let cy = 0; cy < grid.height; cy++) {
          const bitset = (dwGroundSet >>> bit) & 0x03;
          if (bitset === 0) {
            grid.setNullItem(cx, cy);
          } else {
            const tileId = getBgTile(rom, bitset, gType, world, true);
            grid.forceSetItem(cx, cy, {
              tileId,
              type: bitset,
              regularId: 0,
              groundType: gType,
            });
          }
          bit -= 2;
        }
      }
    } else {
      for (let cy = seg.startPos; cy < grid.height; cy++) {
        let bit = 30;
        for (let cx = 0; cx < grid.width; cx++) {
          const bitset = (dwGroundSet >>> bit) & 0x03;
          if (bitset === 0) {
            grid.setNullItem(cx, cy);
          } else {
            const tileId = getBgTile(rom, bitset, gType, world, false);
            grid.forceSetItem(cx, cy, {
              tileId,
              type: bitset,
              regularId: 0,
              groundType: gType,
            });
          }
          bit -= 2;
        }
      }
    }
  }
}
