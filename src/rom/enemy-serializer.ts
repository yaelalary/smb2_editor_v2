/**
 * SMB2 enemy data serializer — Unit 5 (conservative mode only).
 *
 * Conservative mode re-emits each page's captured source bytes in the
 * same order they were parsed. Since the block's byte length was
 * itself derived from the original pointer arithmetic, concatenating
 * page source bytes reproduces the block exactly as it appeared in
 * the ROM.
 *
 * Constructive mode (re-encoding from the interpreted pages) will
 * land with Phase 2 editing features, once the UI can mutate enemy
 * placements.
 */

import type { EnemyBlock, EnemyPage } from './model';

interface SerializableEnemyBlock {
  readonly pages: ReadonlyArray<EnemyPage>;
  readonly byteLength: number;
  readonly romOffset: number;
  readonly isEdited: boolean;
}

export function serializeEnemyBlock(block: EnemyBlock | SerializableEnemyBlock): Uint8Array {
  if (block.isEdited) {
    return serializeConstructive(block);
  }
  return serializeConservative(block);
}

function serializeConservative(block: EnemyBlock | SerializableEnemyBlock): Uint8Array {
  const out = new Uint8Array(block.byteLength);
  let cursor = 0;
  for (const page of block.pages) {
    const pageLen = page.sourceRange[1] - page.sourceRange[0];
    if (cursor + pageLen > out.byteLength) {
      throw new Error(
        `Conservative serialize overflow for enemy block at 0x${block.romOffset.toString(16)}: ` +
          `cursor ${cursor} + page ${pageLen} > block length ${block.byteLength}`,
      );
    }
    // Build the page bytes from its size byte + enemies' sourceBytes.
    // We do not stash per-page raw bytes on the page itself; rebuilding
    // from size byte + enemy.sourceBytes is a tiny cost and keeps the
    // model shape focused on the interpreted view.
    out[cursor] = page.sizeByte;
    cursor += 1;
    for (const enemy of page.enemies) {
      out.set(enemy.sourceBytes, cursor);
      cursor += enemy.sourceBytes.byteLength;
    }
  }

  if (cursor !== block.byteLength) {
    throw new Error(
      `Conservative serialize length mismatch for enemy block at 0x${block.romOffset.toString(16)}: ` +
        `wrote ${cursor} bytes, expected ${block.byteLength}`,
    );
  }

  return out;
}

/**
 * Re-encode enemy pages from the interpreted model. Much simpler than
 * level constructive serialization — no cursor encoding needed.
 * Each page: [sizeByte] [N × (id, (x<<4)|y)].
 */
function serializeConstructive(block: EnemyBlock | SerializableEnemyBlock): Uint8Array {
  const bytes: number[] = [];
  for (const page of block.pages) {
    const sizeByte = 1 + page.enemies.length * 2;
    bytes.push(sizeByte);
    for (const enemy of page.enemies) {
      bytes.push(enemy.id & 0x7f);
      bytes.push(((enemy.x & 0x0f) << 4) | (enemy.y & 0x0f));
    }
  }
  return new Uint8Array(bytes);
}
