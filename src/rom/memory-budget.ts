/**
 * Memory budget calculator — Unit 13.
 *
 * The ROM has a fixed-size region (NES_PTR_START..NES_PTR_EOF = 16 384
 * bytes) that holds ALL level data + enemy data + pointer tables.
 * This module computes how much of that space is currently used.
 *
 * Mirrors C++ `CFileLoader::GetMemoryStatus()` in cnesfile.cpp:644.
 *
 *   systemData  = pointer overhead (level ptrs + enemy ptrs + starts)
 *   levelData   = Σ block.byteLength for each unique level block
 *   enemyData   = Σ block.byteLength for each unique enemy block
 *   used        = systemData + levelData + enemyData
 *   total       = NES_PTR_EOF - NES_PTR_START
 */

import type { LevelMap, EnemyMap, LevelBlock, EnemyBlock } from './model';
import {
  MAX_LEVELS,
  NES_PTR_START,
  NES_PTR_EOF,
} from './constants';

const WORLDS = Math.floor(MAX_LEVELS / 10); // 21

export interface MemoryUsage {
  /** Fixed overhead: pointer tables + starts array. */
  systemData: number;
  /** Sum of serialized level block sizes (unique blocks only). */
  levelData: number;
  /** Sum of serialized enemy block sizes (unique blocks only). */
  enemyData: number;
  /** Total bytes used = system + level + enemy. */
  used: number;
  /** Total available bytes in the ROM region. */
  total: number;
  /** used / total as a 0-1 ratio. */
  ratio: number;
  /** Bytes remaining (can be negative if over budget). */
  free: number;
}

/**
 * Compute current memory usage of the level+enemy data region.
 *
 * C++ formula (cnesfile.cpp:652-655):
 *   systemData =
 *     MAX_LEVELS * 2            // enemy ptr lo+hi arrays (210 * 2 = 420)
 *     + (MAX_LEVELS / 10) * 4   // 2 enemy ptrs-to-ptrs arrays (21 * 4 = 84)
 *     + MAX_LEVELS * 2           // level ptr lo+hi arrays (210 * 2 = 420)
 *     + MAX_LEVELS / 10;         // level starts array (21)
 *   = 420 + 84 + 420 + 21 = 945 bytes
 */
export function computeUsage(
  levelMap: LevelMap,
  enemyMap: EnemyMap,
): MemoryUsage {
  const total = NES_PTR_EOF - NES_PTR_START; // 16384

  // Fixed pointer overhead (same formula as C++)
  const systemData =
    MAX_LEVELS * 2 +       // enemy ptr arrays
    WORLDS * 4 +           // enemy ptrs-to-ptrs
    MAX_LEVELS * 2 +       // level ptr arrays
    WORLDS;                // level starts

  // Level data: sum of each unique block's byte length (+ 1 for terminator
  // is already included in byteLength by our parser, matching C++
  // SizeOfLevel() + 1).
  let levelData = 0;
  for (const block of levelMap.blocks as ReadonlyArray<LevelBlock>) {
    levelData += block.byteLength;
  }

  // Enemy data: sum of each unique block's byte length.
  let enemyData = 0;
  for (const block of enemyMap.blocks as ReadonlyArray<EnemyBlock>) {
    enemyData += block.byteLength;
  }

  const used = systemData + levelData + enemyData;
  const free = total - used;
  const ratio = total > 0 ? used / total : 1;

  return { systemData, levelData, enemyData, used, total, ratio, free };
}
