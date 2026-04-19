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
 * Re-encode items from their absolute tileX/tileY positions while
 * preserving the ORIGINAL stream order of meta items (groundSet,
 * groundType, pointer). These meta items are cursor-state-dependent:
 *   - groundSet.startPos is computed from the cursor deltaX/deltaY at
 *     the stream point they appear (see `computeGroundSegments` in
 *     ground-pass.ts).
 *   - pointer items (door links) similarly carry implicit stream
 *     context used elsewhere in the tool.
 * Grouping them at the start would collapse every ground transition and
 * door link to (0, 0), breaking the level.
 *
 * Strategy:
 *   1. Walk items in their ORIGINAL stream order.
 *   2. Drop original skipper (0xF2/0xF3) and backToStart (0xF4) — we
 *      regenerate them based on cursor moves needed between regulars.
 *   3. For regular/entrance items: compute cursor-target from current
 *      absolute tileX/tileY (direction-aware), emit skippers as needed,
 *      then emit the position byte + id.
 *   4. For meta items (groundSet, groundType, pointer, unknown): emit
 *      sourceBytes verbatim. Do NOT modify cursor state — these items
 *      read cursor state, they don't advance it.
 *
 * Direction-aware math (cneseditor_loader.cpp:57):
 *   horizontal:  tileX = deltaX + ix,  tileY = deltaY
 *   vertical:    tileX = ix,           tileY = deltaY + 15*(deltaX/16)
 * The cursor's `deltaX` advances by 16 per skipper in both directions.
 * In vertical levels it represents "how many vertical pages deep" × 16.
 */
function serializeConstructive(block: SerializableLevelBlock): Uint8Array {
  const headerBytes = packLevelHeader(block.header);
  const isH = block.header.direction === 1;

  const bytes: number[] = [];
  let deltaX = 0;
  let deltaY = 0;

  /** Advance the cursor forward to (targetDeltaX, ≤targetDeltaY) via skippers. */
  function advanceCursorTo(targetDeltaX: number, targetDeltaY: number): void {
    // Y rewind within same page, or cursor is past target → backToStart.
    if (deltaX > targetDeltaX || (deltaX === targetDeltaX && deltaY > targetDeltaY)) {
      bytes.push(0xf4); // backToStart
      deltaX = 0;
      deltaY = 0;
    }
    // Skip forward by pages (F3 = +32, F2 = +16). Skipper resets deltaY to 0.
    while (deltaX + 32 <= targetDeltaX) {
      bytes.push(0xf3);
      deltaX += 32;
      deltaY = 0;
    }
    while (deltaX < targetDeltaX) {
      bytes.push(0xf2);
      deltaX += 16;
      deltaY = 0;
    }
  }

  for (const item of block.items) {
    switch (item.kind) {
      case 'skipper':
      case 'backToStart':
        // Regenerated on demand — drop original.
        continue;

      case 'groundSet':
      case 'groundType':
      case 'pointer':
      case 'unknown':
        // Stream-order meta items. Emit verbatim at their original
        // stream position so the cursor state they observe is stable.
        for (let i = 0; i < item.sourceBytes.byteLength; i++) {
          bytes.push(item.sourceBytes[i]!);
        }
        continue;

      case 'regular':
      case 'entrance': {
        if (item.tileX < 0 || item.tileY < 0) continue;

        // Resolve the cursor target for this item based on direction.
        let targetDeltaX: number;
        let targetDeltaY: number;
        let localX: number;
        if (isH) {
          // Horizontal: deltaX is the page left-edge, ix is within page,
          // deltaY IS tileY. pages are 16 wide.
          targetDeltaX = Math.floor(item.tileX / 16) * 16;
          targetDeltaY = item.tileY;
          localX = item.tileX % 16;
        } else {
          // Vertical: deltaX advances per vertical page (+16 per skipper).
          // tileY = deltaY + 15*(deltaX/16) → page = floor(tileY / 15).
          const page = Math.floor(item.tileY / 15);
          targetDeltaX = page * 16;
          targetDeltaY = item.tileY - 15 * page;
          localX = item.tileX & 0x0f;
        }

        advanceCursorTo(targetDeltaX, targetDeltaY);

        const iy = targetDeltaY - deltaY;
        const positionByte = ((iy & 0x0f) << 4) | (localX & 0x0f);
        bytes.push(positionByte);
        bytes.push(item.itemId & 0xff);

        // Entrance extra param bytes (destination pointer, etc.).
        if (item.kind === 'entrance' && item.sourceBytes.byteLength > 2) {
          for (let i = 2; i < item.sourceBytes.byteLength; i++) {
            bytes.push(item.sourceBytes[i]!);
          }
        }

        // Update cursor per C++ loader rule: deltaY += iy, then if it
        // reached 15 it wraps to 0 and deltaX advances by 16.
        deltaY += iy;
        if (deltaY >= 15) {
          deltaY = (deltaY + 1) % 16;
          deltaX += 16;
        }
        continue;
      }
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
