/**
 * SMB2 level serializer — Unit 4 (conservative mode only).
 *
 * Emits bytes that reconstruct an exact copy of the original level
 * block by concatenating:
 *   - The header's original 4 source bytes
 *   - Each item's `sourceBytes`
 *   - The 0xFF terminator
 *
 * No interpretation of the parsed header or per-item fields is used
 * here — conservative mode's whole point is to guarantee byte-identity
 * for unmodified ROMs. Constructive serialization (regenerating bytes
 * from the interpreted model, required before any editing ships)
 * lands in Phase 2 as part of the Unit 4 constructive-mode follow-up.
 */

import { LEVEL_TERMINATOR } from './constants';
import type { LevelBlock } from './model';

/**
 * Concatenate a {@link LevelBlock}'s header source bytes, all item
 * source bytes, and the 0xFF terminator. The output length equals
 * `block.byteLength` by construction — any mismatch indicates the
 * parser populated the block inconsistently and is a bug.
 */
export function serializeLevelBlock(block: LevelBlock): Uint8Array {
  const out = new Uint8Array(block.byteLength);
  let cursor = 0;

  out.set(block.header.sourceBytes, cursor);
  cursor += block.header.sourceBytes.byteLength;

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
