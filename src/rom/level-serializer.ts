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
  if (block.isEdited) {
    return serializeConstructive(block);
  }
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
/**
 * Re-encode items from their absolute tileX/tileY positions. Used for
 * edited blocks (items added, deleted, or moved).
 *
 * Strategy (simple and deterministic):
 *   - Meta items (groundSet, groundType, pointer) are emitted first,
 *     preserving their original sourceBytes.
 *   - Visible items are sorted by page → Y → X.
 *   - For each page transition: emit backToStart (0xF4) + skippers
 *     (0xF2/0xF3) to reach the target page. This resets cursorY to 0.
 *   - For Y advancement within a page: iy = targetY - cursorY (always
 *     0..14 after a page reset, so no unwanted Y-wrap occurs).
 *   - Position byte = (iy << 4) | localX.
 *
 * This encoding may use more bytes than the original (extra meta items
 * for page jumps), but is always correct. The budget check in buildRom
 * ensures the total fits.
 */
function serializeConstructive(block: SerializableLevelBlock): Uint8Array {
  const headerBytes = packLevelHeader(block.header);

  const visible: LevelItem[] = [];
  const meta: LevelItem[] = [];
  for (const item of block.items) {
    if (
      (item.kind === 'regular' || item.kind === 'entrance') &&
      item.tileX >= 0 &&
      item.tileY >= 0
    ) {
      visible.push(item);
    } else if (
      item.kind === 'groundSet' ||
      item.kind === 'groundType' ||
      item.kind === 'pointer'
    ) {
      meta.push(item);
    }
    // skipper / backToStart are regenerated — don't copy originals.
  }

  visible.sort((a, b) => {
    const pageA = Math.floor(a.tileX / 16);
    const pageB = Math.floor(b.tileX / 16);
    if (pageA !== pageB) return pageA - pageB;
    if (a.tileY !== b.tileY) return a.tileY - b.tileY;
    return (a.tileX % 16) - (b.tileX % 16);
  });

  const bytes: number[] = [];

  // Emit meta items at the start.
  for (const m of meta) {
    for (let i = 0; i < m.sourceBytes.byteLength; i++) {
      bytes.push(m.sourceBytes[i]!);
    }
  }

  // Encode visible items with explicit page management.
  let cursorPage = 0;
  let cursorY = 0;

  for (const item of visible) {
    const targetPage = Math.floor(item.tileX / 16);
    const targetLocalX = item.tileX % 16;
    const targetY = item.tileY;

    // Page transition or Y-rewind needed?
    if (targetPage !== cursorPage || targetY < cursorY) {
      bytes.push(0xf4); // backToStart → resets cursor to page 0, Y 0
      cursorPage = 0;
      cursorY = 0;

      // Skip to target page.
      let toSkip = targetPage;
      while (toSkip >= 2) {
        bytes.push(0xf3);
        cursorPage += 2;
        toSkip -= 2;
      }
      if (toSkip >= 1) {
        bytes.push(0xf2);
        cursorPage += 1;
      }
    }

    // Y delta — always >= 0 and < 15 after a page reset.
    const iy = targetY - cursorY;

    const positionByte = ((iy & 0x0f) << 4) | (targetLocalX & 0x0f);
    bytes.push(positionByte);
    bytes.push(item.itemId & 0xff);

    // Entrance items may have extra parameter bytes (4 or 5 byte total).
    if (item.kind === 'entrance' && item.sourceBytes.byteLength > 2) {
      for (let i = 2; i < item.sourceBytes.byteLength; i++) {
        bytes.push(item.sourceBytes[i]!);
      }
    }

    // Update cursor Y.
    cursorY += iy;
    if (cursorY >= 15) {
      cursorY = (cursorY + 1) % 16;
      cursorPage += 1;
    }
  }

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
