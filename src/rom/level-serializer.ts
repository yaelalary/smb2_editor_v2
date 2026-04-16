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
import type { LevelBlock, LevelHeader } from './model';

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
 * Serialize a level block. Uses constructive header packing when the
 * header has been modified (sourceBytes stale), and conservative
 * sourceBytes for items (items are not editable yet in Phase 2 Unit 8).
 */
export function serializeLevelBlock(block: LevelBlock): Uint8Array {
  const out = new Uint8Array(block.byteLength);
  let cursor = 0;

  // Use constructive header if fields were edited, else conservative.
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
      `Serialize length mismatch for block at 0x${block.romOffset.toString(16)}: ` +
        `wrote ${cursor} bytes before terminator, expected ${block.byteLength - 1}`,
    );
  }

  out[cursor] = LEVEL_TERMINATOR;
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
