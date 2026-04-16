/**
 * SMB2 level serializer — Unit 4 (conservative) + Unit 8 (constructive header).
 *
 * Two serialization modes:
 *
 *   - **Conservative** (`serializeLevelBlock`): re-emits captured source
 *     bytes. Guarantees byte-identity for unmodified ROMs.
 *   - **Constructive header** (`packLevelHeader`): repacks the 8
 *     interpreted header fields + reserved bits into 4 on-disk bytes.
 *     Used when the user edits a header field via the properties panel.
 *
 * `serializeLevelBlock` now uses `packLevelHeader` when the header's
 * `sourceBytes` don't match the interpreted fields (i.e., the header
 * was edited). Otherwise it falls back to `sourceBytes` (conservative).
 */

import { LEVEL_HEADER_BYTES, LEVEL_TERMINATOR } from './constants';
import type { LevelHeader, LevelItem } from './model';

/** Accept both mutable and readonly LevelBlock for serialization. */
interface SerializableLevelBlock {
  readonly romOffset: number;
  readonly header: LevelHeader;
  readonly items: ReadonlyArray<LevelItem>;
  readonly byteLength: number;
  readonly isEdited: boolean;
}

/**
 * Pack the 8 interpreted header fields + reserved bits back into 4
 * big-endian bytes, exactly reversing `parseLevelHeader`.
 *
 * Bit layout (same as the parser, see `level-parser.ts`):
 *
 *   b0: [direction:1][reserved:1][palette:3][reserved:1][enemyColor:2]
 *   b1: [reserved:3][groundSet:5]
 *   b2: [length:4][objectType:4]
 *   b3: [reserved:2][groundType:3][reserved:1][music:2]
 *
 * Reserved bits are re-injected from `header.reservedBits`.
 */
export function packLevelHeader(header: LevelHeader): Uint8Array {
  const out = new Uint8Array(LEVEL_HEADER_BYTES);

  // Unpack reserved bits (packed MSB-first in disk order):
  //   bit7 → b0 bit 6, bit6 → b0 bit 2, bits5-3 → b1 bits 7-5,
  //   bits2-1 → b3 bits 7-6, bit0 → b3 bit 2.
  const r = header.reservedBits;
  const r_b0_6 = (r >> 7) & 1;
  const r_b0_2 = (r >> 6) & 1;
  const r_b1_765 = (r >> 3) & 0b111;
  const r_b3_76 = (r >> 1) & 0b11;
  const r_b3_2 = r & 1;

  out[0] =
    ((header.direction & 1) << 7) |
    (r_b0_6 << 6) |
    ((header.palette & 0b111) << 3) |
    (r_b0_2 << 2) |
    (header.enemyColor & 0b11);

  out[1] =
    (r_b1_765 << 5) |
    (header.groundSet & 0b11111);

  out[2] =
    ((header.length & 0b1111) << 4) |
    (header.objectType & 0b1111);

  out[3] =
    (r_b3_76 << 6) |
    ((header.groundType & 0b111) << 3) |
    (r_b3_2 << 2) |
    (header.music & 0b11);

  return out;
}

/**
 * Serialize a level block. Two modes:
 *
 *   - **Conservative** (isEdited = false): re-emit header.sourceBytes +
 *     item.sourceBytes + 0xFF. Byte-identical to the original.
 *   - **Constructive** (isEdited = true): pack header from interpreted
 *     fields, re-encode ALL items from their absolute tileX/tileY +
 *     itemId, append 0xFF. The byte stream may differ from the original
 *     (different ordering, different cursor deltas) but produces the
 *     same in-game result.
 */
export function serializeLevelBlock(block: SerializableLevelBlock): Uint8Array {
  // TODO: The constructive serializer (serializeConstructive) exists but
  // produces incorrect cursor encoding, causing ROM corruption. Disabled
  // until the encoding logic is fixed and a full re-pack of the level
  // data region is implemented (so growing blocks don't overwrite
  // adjacent data).
  //
  // For now: ALWAYS use conservative mode. This means:
  //   - Property edits (header changes) → constructive HEADER only (works)
  //   - Item adds/deletes/moves → visual only (undo/redo works), but
  //     the downloaded ROM reflects the ORIGINAL items, not the edits.
  //
  // The user gets a warning in buildRom if edits would be lost.
  return serializeConservative(block);
}

function serializeConservative(block: SerializableLevelBlock): Uint8Array {
  const out = new Uint8Array(block.byteLength);
  let cursor = 0;

  const headerBytes = headerMatchesSource(block.header)
    ? block.header.sourceBytes
    : packLevelHeader(block.header);

  out.set(headerBytes, cursor);
  cursor += headerBytes.byteLength;

  for (const item of block.items) {
    out.set(item.sourceBytes, cursor);
    cursor += item.sourceBytes.byteLength;
  }

  if (cursor !== block.byteLength - 1) {
    throw new Error(
      `Conservative serialize length mismatch for block at 0x${block.romOffset.toString(16)}: ` +
        `wrote ${cursor} bytes before terminator, expected ${block.byteLength - 1}`,
    );
  }

  out[cursor] = LEVEL_TERMINATOR;
  return out;
}

/**
 * Re-encode the ENTIRE item stream from absolute positions. This is
 * used when the block has been edited (items added, removed, or moved).
 *
 * Strategy:
 *   1. Separate visible items (regular/entrance with positions) from
 *      meta items (groundSet, groundType — preserved in original order).
 *   2. Sort visible items by page (tileX / 16), then Y, then X.
 *   3. Encode each item with the appropriate cursor deltas, inserting
 *      backToStart (0xF4) and skipper (0xF2/0xF3) meta items as needed.
 *   4. Intersperse preserved meta items at the start of each page.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for future use, disabled until cursor encoding is fixed
function serializeConstructive(block: SerializableLevelBlock): Uint8Array {
  const headerBytes = packLevelHeader(block.header);

  // Separate visible items from meta items.
  const visible: LevelItem[] = [];
  const meta: LevelItem[] = [];
  for (const item of block.items) {
    if (item.tileX >= 0 && item.tileY >= 0) {
      visible.push(item);
    } else {
      meta.push(item);
    }
  }

  // Sort visible items: by page, then Y, then local X.
  visible.sort((a, b) => {
    const pageA = Math.floor(a.tileX / 16);
    const pageB = Math.floor(b.tileX / 16);
    if (pageA !== pageB) return pageA - pageB;
    if (a.tileY !== b.tileY) return a.tileY - b.tileY;
    return (a.tileX % 16) - (b.tileX % 16);
  });

  // Encode items into a byte buffer.
  const bytes: number[] = [];

  // Emit meta items at the start (groundSet, groundType, etc.)
  for (const m of meta) {
    for (let i = 0; i < m.sourceBytes.byteLength; i++) {
      bytes.push(m.sourceBytes[i]!);
    }
  }

  // Encode visible items with cursor tracking.
  let cursorDeltaX = 0;
  let cursorDeltaY = 0;

  for (const item of visible) {
    const targetPage = Math.floor(item.tileX / 16);
    const targetLocalX = item.tileX % 16;
    const targetY = item.tileY;
    const currentPage = Math.floor(cursorDeltaX / 16);

    // Need to jump to a different page or Y is before cursor?
    if (targetPage < currentPage || targetY < cursorDeltaY) {
      // Emit backToStart.
      bytes.push(0xf4);
      cursorDeltaX = 0;
      cursorDeltaY = 0;
    }

    // Emit skippers to reach the target page.
    const neededPage = Math.floor(item.tileX / 16);
    const curPage = Math.floor(cursorDeltaX / 16);
    let pagesToSkip = neededPage - curPage;
    while (pagesToSkip >= 2) {
      bytes.push(0xf3); // skip 2 pages
      cursorDeltaX += 0x20;
      pagesToSkip -= 2;
    }
    while (pagesToSkip >= 1) {
      bytes.push(0xf2); // skip 1 page
      cursorDeltaX += 0x10;
      pagesToSkip -= 1;
    }

    // Compute Y delta.
    let iy = targetY - cursorDeltaY;
    if (iy < 0) {
      // Y is before current cursor — shouldn't happen after sort + backToStart.
      // Defensive: emit backToStart and re-approach.
      bytes.push(0xf4);
      cursorDeltaX = 0;
      cursorDeltaY = 0;
      // Re-emit skippers.
      let pg = Math.floor(item.tileX / 16);
      while (pg >= 2) {
        bytes.push(0xf3);
        cursorDeltaX += 0x20;
        pg -= 2;
      }
      while (pg >= 1) {
        bytes.push(0xf2);
        cursorDeltaX += 0x10;
        pg -= 1;
      }
      iy = targetY;
    }

    // Handle iy >= 15 (would cause unwanted page wrap).
    // If iy >= 15, the cursor wraps to next page.
    // We handle by keeping iy < 15 and emitting multiple items? No.
    // Actually we CAN let the wrap happen if targetPage matches.
    // For safety, clamp iy to 0-14 range.
    if (iy > 14) iy = 14;

    const ix = targetLocalX;
    const positionByte = ((iy & 0x0f) << 4) | (ix & 0x0f);

    // Emit position byte + item ID (for regular items, 2 bytes).
    bytes.push(positionByte);
    if (item.kind === 'regular' || item.kind === 'entrance') {
      bytes.push(item.itemId & 0xff);
      // For entrance items with parameters (4 or 5 bytes), emit the
      // extra bytes from sourceBytes if they exist.
      if (item.sourceBytes.byteLength > 2) {
        for (let i = 2; i < item.sourceBytes.byteLength; i++) {
          bytes.push(item.sourceBytes[i]!);
        }
      }
    }

    // Update cursor.
    cursorDeltaY += iy;
    if (cursorDeltaY >= 0x0f) {
      cursorDeltaY = (cursorDeltaY + 1) % 16;
      cursorDeltaX += 0x10;
    }
  }

  // Build the final buffer: header + items + terminator.
  const totalLen = LEVEL_HEADER_BYTES + bytes.length + 1;
  const out = new Uint8Array(totalLen);
  out.set(headerBytes, 0);
  for (let i = 0; i < bytes.length; i++) {
    out[LEVEL_HEADER_BYTES + i] = bytes[i]!;
  }
  out[totalLen - 1] = LEVEL_TERMINATOR;
  return out;
}

/**
 * Check whether the interpreted header fields still match the original
 * source bytes. If they do, conservative emit is safe and avoids any
 * risk of re-packing drift. If they don't, the header was edited and
 * we must use constructive packing.
 */
function headerMatchesSource(header: LevelHeader): boolean {
  const packed = packLevelHeader(header);
  if (packed.byteLength !== header.sourceBytes.byteLength) return false;
  for (let i = 0; i < packed.byteLength; i++) {
    if (packed[i] !== header.sourceBytes[i]) return false;
  }
  return true;
}
