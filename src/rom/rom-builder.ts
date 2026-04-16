/**
 * ROM builder — full re-pack of the level data region.
 *
 * Mirrors the C++ tool's Write() function. All internal pointer math
 * uses **CPU addresses** (the NES's address space). To convert to a
 * ROM file offset for writing: `romOffset = cpuAddr + DELTA_PTR`.
 */

import type { LevelMap, EnemyMap, LevelBlock, EnemyBlock } from './model';
import { serializeLevelBlock } from './level-serializer';
import { serializeEnemyBlock } from './enemy-serializer';
import {
  DELTA_PTR,
  LEVELS_PER_WORLD,
  MAX_LEVELS,
  NES_PTR_EOF,
  NES_PTR_START,
  WORLDS,
} from './constants';

export class BudgetExceededError extends Error {
  constructor(used: number, total: number) {
    super(
      `Level + enemy data (${used} bytes) exceeds the ROM budget ` +
        `(${total} bytes). Remove items to continue.`,
    );
    this.name = 'BudgetExceededError';
  }
}

function writeU16LE(buf: Uint8Array, romOffset: number, value: number): void {
  buf[romOffset] = value & 0xff;
  buf[romOffset + 1] = (value >> 8) & 0xff;
}

/** Convert a CPU address to a ROM file offset. */
function toRom(cpuAddr: number): number {
  return cpuAddr + DELTA_PTR;
}

const STARTS_SIZE = WORLDS; // 21
const TOTAL_REGION = NES_PTR_EOF - NES_PTR_START; // 16384

export function buildRom(
  originalRom: Uint8Array,
  levelMap: LevelMap | { blocks: ReadonlyArray<LevelBlock>; slotToBlock: ReadonlyArray<number> },
  enemyMap: EnemyMap | { blocks: ReadonlyArray<EnemyBlock>; slotToBlock: ReadonlyArray<number> },
): Uint8Array {
  const output = new Uint8Array(originalRom.byteLength);
  output.set(originalRom);

  const hasEdits = (levelMap.blocks as ReadonlyArray<LevelBlock>).some(
    (b) => b.isEdited,
  );

  if (!hasEdits) {
    // Conservative overlay — proven byte-identical by round-trip tests.
    for (const block of levelMap.blocks as ReadonlyArray<LevelBlock>) {
      const s = serializeLevelBlock(block);
      output.set(s, block.sourceRange[0]);
    }
    for (const block of enemyMap.blocks as ReadonlyArray<EnemyBlock>) {
      const s = serializeEnemyBlock(block);
      output.set(s, block.sourceRange[0]);
    }
    return output;
  }

  // ─── Full re-pack (CPU address space, like C++ Write()) ──────────

  // CPU address of the starts table (first item in the region).
  const startsAddr = NES_PTR_START - DELTA_PTR;

  // Level pointer tables right after starts.
  const lvlPtrLoAddr = startsAddr + STARTS_SIZE;
  const lvlPtrHiAddr = lvlPtrLoAddr + MAX_LEVELS;

  // Level data starts right after pointer tables.
  let ptr = lvlPtrHiAddr + MAX_LEVELS; // CPU addr cursor

  // 1. Serialize + pack level blocks sequentially.
  const lvlBlocks = levelMap.blocks as ReadonlyArray<LevelBlock>;
  const lvlAddrs: number[] = []; // CPU address per unique block

  for (const block of lvlBlocks) {
    const serialized = serializeLevelBlock(block);
    if (toRom(ptr) + serialized.byteLength > NES_PTR_EOF) {
      throw new BudgetExceededError(
        toRom(ptr) + serialized.byteLength - NES_PTR_START,
        TOTAL_REGION,
      );
    }
    output.set(serialized, toRom(ptr));
    lvlAddrs.push(ptr);
    ptr += serialized.byteLength;
  }

  // 2. Write level pointer tables (slot → unique block CPU addr).
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    const blockIdx = levelMap.slotToBlock[slot]!;
    const addr = lvlAddrs[blockIdx]!;
    output[toRom(lvlPtrLoAddr) + slot] = addr & 0xff;
    output[toRom(lvlPtrHiAddr) + slot] = (addr >> 8) & 0xff;
  }

  // 3. Enemy pointer sub-tables + data.
  //    4 base arrays (21 bytes each) + 21 per-world arrays (20 bytes each).
  const enmBase0 = ptr; // CPU addr
  const enmBase1 = enmBase0 + WORLDS;
  const enmBase2 = enmBase1 + WORLDS;
  const enmBase3 = enmBase2 + WORLDS;
  const perWorldStart = enmBase3 + WORLDS;
  const perWorldTotal = WORLDS * LEVELS_PER_WORLD * 2; // 420
  let enmDataPtr = perWorldStart + perWorldTotal; // CPU addr, enemy data starts here

  // Fill gap between level data end and enemy pointer tables with 0xFF.
  for (let i = toRom(ptr); i < toRom(enmBase0); i++) {
    // ptr already points past level data; enmBase0 = ptr. No gap needed
    // when they're equal, but defensive.
    output[i] = 0xff;
  }

  // 4. Serialize + pack enemy blocks sequentially.
  const enmBlocks = enemyMap.blocks as ReadonlyArray<EnemyBlock>;
  const enmAddrs: number[] = [];

  for (const block of enmBlocks) {
    const serialized = serializeEnemyBlock(block);
    if (toRom(enmDataPtr) + serialized.byteLength > NES_PTR_EOF) {
      throw new BudgetExceededError(
        toRom(enmDataPtr) + serialized.byteLength - NES_PTR_START,
        TOTAL_REGION,
      );
    }
    output.set(serialized, toRom(enmDataPtr));
    enmAddrs.push(enmDataPtr);
    enmDataPtr += serialized.byteLength;
  }

  // Fill remaining space with 0xFF.
  for (let i = toRom(enmDataPtr); i < NES_PTR_EOF; i++) {
    output[i] = 0xff;
  }

  // 5. Write enemy pointer sub-tables.
  for (let w = 0; w < WORLDS; w++) {
    const worldHiArr = perWorldStart + w * LEVELS_PER_WORLD * 2;
    const worldLoArr = worldHiArr + LEVELS_PER_WORLD;

    for (let l = 0; l < LEVELS_PER_WORLD; l++) {
      const slot = w * LEVELS_PER_WORLD + l;
      const blockIdx = enemyMap.slotToBlock[slot]!;
      const addr = enmAddrs[blockIdx]!;
      output[toRom(worldHiArr) + l] = (addr >> 8) & 0xff;
      output[toRom(worldLoArr) + l] = addr & 0xff;
    }

    output[toRom(enmBase0) + w] = (worldHiArr >> 8) & 0xff;
    output[toRom(enmBase1) + w] = worldHiArr & 0xff;
    output[toRom(enmBase2) + w] = (worldLoArr >> 8) & 0xff;
    output[toRom(enmBase3) + w] = worldLoArr & 0xff;
  }

  // 6. Update main pointer constants (outside the data region).
  writeU16LE(output, 0x1f768, startsAddr); // level starts
  writeU16LE(output, 0x1f770, lvlPtrLoAddr); // level ptr lo
  writeU16LE(output, 0x1f775, lvlPtrHiAddr); // level ptr hi
  writeU16LE(output, 0x1f791, enmBase0);
  writeU16LE(output, 0x1f796, enmBase1);
  writeU16LE(output, 0x1f79b, enmBase2);
  writeU16LE(output, 0x1f7a0, enmBase3);

  return output;
}
