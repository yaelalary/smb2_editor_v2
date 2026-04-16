/**
 * ROM builder — assembles a complete .nes file from the parsed model.
 *
 * Strategy: **clone and overlay**.
 *   1. Clone the original uploaded ROM buffer in full.
 *   2. Serialize every level block (conservative mode for v0.1).
 *   3. Write each serialized block back into the clone at its original
 *      ROM offset (source range from the parser).
 *   4. Do the same for every enemy block.
 *   5. Return the clone — it is now the "output ROM".
 *
 * For v0.1 (conservative serialize = re-emit captured source bytes),
 * the overlay writes the exact same bytes back at the exact same
 * positions, producing a byte-identical clone. This is intentional:
 * it proves the full serialize → overlay pipeline works so that Phase 2
 * editing can drop in constructive serialization without changing the
 * download path.
 *
 * Phase 2+: the constructive serializer may produce different-length
 * blocks. At that point, the overlay step must also re-pack the level
 * region sequentially and rewrite the pointer tables. That logic will
 * be added when editing ships.
 */

import type { LevelMap, EnemyMap, LevelBlock, EnemyBlock } from './model';
import { serializeLevelBlock } from './level-serializer';
import { serializeEnemyBlock } from './enemy-serializer';

/** Accept Pinia's DeepReadonly-wrapped maps too. */
interface ReadonlyLevelMap {
  readonly blocks: ReadonlyArray<Pick<LevelBlock, 'romOffset' | 'header' | 'items' | 'byteLength' | 'sourceRange' | 'isEdited'>>;
}

interface ReadonlyEnemyMap {
  readonly blocks: ReadonlyArray<Pick<EnemyBlock, 'romOffset' | 'pages' | 'byteLength' | 'sourceRange'>>;
}

/**
 * Build a complete .nes ROM from the parsed model by cloning the
 * original and overlaying serialized level + enemy blocks.
 */
export function buildRom(
  originalRom: Uint8Array,
  levelMap: LevelMap | ReadonlyLevelMap,
  enemyMap: EnemyMap | ReadonlyEnemyMap,
): Uint8Array {
  // 1. Clone.
  const output = new Uint8Array(originalRom.byteLength);
  output.set(originalRom);

  // 2. Overlay level blocks.
  //    WARNING: constructive item serialization is disabled (see
  //    level-serializer.ts). Blocks with isEdited=true will still use
  //    conservative mode — item edits (add/delete/move) are NOT
  //    reflected in the output. Only header edits are persisted.
  for (const block of levelMap.blocks) {
    const serialized = serializeLevelBlock(block as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- readonly compat
    output.set(serialized, block.sourceRange[0]);
  }

  // 3. Overlay enemy blocks.
  for (const block of enemyMap.blocks) {
    const serialized = serializeEnemyBlock(block as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- readonly compat
    output.set(serialized, block.sourceRange[0]);
  }

  return output;
}
