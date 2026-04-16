/**
 * Level item positioning — computes screen coordinates for items.
 *
 * SMB2 levels encode item positions via a cumulative cursor, not as
 * absolute coordinates. This module ports the `RereadPoints()` logic
 * from `loginsinex/smb2` `cnesleveldata.cpp`:
 *
 *   - Each regular/entrance item's byte[0] carries a high nibble
 *     (Y delta) and a low nibble (X column within the current page).
 *   - Y deltas accumulate in a running counter `deltaY`. When it
 *     reaches ≥ 15 (0x0F), it wraps and the cursor advances one page
 *     (deltaX += 16).
 *   - Skipper items advance the cursor by 1–2 pages.
 *   - BackToStart resets the cursor to (0, 0).
 *   - Meta items (groundSet, groundType, pointer, unknown) produce no
 *     visible object on the canvas.
 *
 * All coordinates are in **tile units** (not pixels). Multiply by
 * `--size-tile` (16 CSS-px) for rendering.
 */

import type { LevelBlock, LevelItem } from './model';

export interface PositionedItem {
  readonly item: LevelItem;
  /** X in tile units (0 = left edge of the level). */
  readonly tileX: number;
  /** Y in tile units (0 = top of the level). */
  readonly tileY: number;
  /** Human-readable item type name for debug overlays. */
  readonly label: string;
}

/** Color key for the canvas rectangle overlay, keyed by item kind. */
export const ITEM_COLORS: Readonly<Record<string, string>> = {
  regular: '#4a90d9',
  entrance: '#50b860',
  pointer: '#c060c0',
  groundSet: '#888',
  groundType: '#888',
  skipper: '#888',
  backToStart: '#888',
  unknown: '#aaa',
};

/**
 * Walk a level block's items and produce positioned items with
 * absolute tile coordinates. Only `regular` and `entrance` items
 * produce visible positioned results; meta items affect the cursor
 * but are not returned.
 */
export function computeItemPositions(block: LevelBlock): PositionedItem[] {
  let deltaX = 0;
  let deltaY = 0;
  const result: PositionedItem[] = [];

  for (const item of block.items) {
    switch (item.kind) {
      case 'skipper': {
        // 0xF2 → low nibble 2, skip 1 page; 0xF3 → skip 2 pages.
        const lowNibble = item.sourceBytes[0]! & 0x0f;
        deltaX += (lowNibble - 1) * 0x10;
        break;
      }

      case 'backToStart':
        deltaX = 0;
        deltaY = 0;
        break;

      case 'regular':
      case 'entrance': {
        const byte0 = item.sourceBytes[0]!;
        const iy = (byte0 >> 4) & 0x0f;
        const ix = byte0 & 0x0f;

        deltaY += iy;
        if (deltaY >= 0x0f) {
          deltaY = (deltaY + 1) % 16;
          deltaX += 0x10;
        }

        const itemId =
          item.sourceBytes.byteLength > 1 ? item.sourceBytes[1]! : -1;
        const label =
          item.kind === 'entrance'
            ? `E:${itemId.toString(16).toUpperCase()}`
            : `${itemId.toString(16).toUpperCase()}`;

        result.push({
          item,
          tileX: deltaX + ix,
          tileY: deltaY,
          label,
        });
        break;
      }

      // Meta items: no visible output, no cursor change.
      case 'groundSet':
      case 'groundType':
      case 'pointer':
      case 'unknown':
        break;
    }
  }

  return result;
}

/**
 * Compute the canvas dimensions (in tile units) for a level block.
 *
 * Horizontal levels: width = (length + 1) pages × 16 tiles, height = 15 tiles.
 * Vertical levels: width = 16 tiles, height = (length + 1) pages × 15 tiles.
 */
export function levelDimensions(block: LevelBlock): {
  widthTiles: number;
  heightTiles: number;
} {
  const pages = block.header.length + 1;
  if (block.header.direction === 1) {
    // Horizontal
    return { widthTiles: pages * 16, heightTiles: 15 };
  }
  // Vertical
  return { widthTiles: 16, heightTiles: pages * 15 };
}
