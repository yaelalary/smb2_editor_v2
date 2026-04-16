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

import type { EnemyBlock } from './model';

export function serializeEnemyBlock(block: EnemyBlock): Uint8Array {
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
