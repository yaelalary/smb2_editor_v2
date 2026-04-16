/**
 * SMB2 enemy data parser — Unit 5.
 *
 * Produces an {@link EnemyMap} from a validated ROM. Mirrors the
 * behavior of `loginsinex/smb2` `cnesenemydata.cpp` and the enemy-
 * loading branch of `cnesfile.cpp` `Read()`.
 *
 * Two decisions distinguish this parser from the level parser:
 *
 *   1. Pointer resolution is a **three-level chain**, not a flat
 *      split-hi/lo array. Four base CPU addresses at
 *      `NES_PTR_ENEMY[1..4]` locate per-world hi/lo arrays; those in
 *      turn locate per-level hi/lo arrays; and those give the final
 *      CPU address of each slot's enemy data block.
 *   2. Enemy blocks have **no internal terminator byte**. Block length
 *      is computed from outside: for all blocks except the last, the
 *      length is the distance to the next block's pointer (after
 *      sorting unique pointers ascending). The last block scans forward
 *      looking for a 0xFF sentinel, bounded by NES_PTR_EOF.
 *
 * Inside a block, pages are packed sequentially:
 *
 *   [size_byte] [size_byte / 2 enemies × 2 bytes each]
 *
 * where `size_byte = 1 + 2 * N` (odd, never 0xFF in practice). An
 * empty page is just `0x01` with no enemies following.
 */

import {
  DELTA_PTR,
  LEVELS_PER_WORLD,
  MAX_LEVELS,
  NES_PTR_ENEMY1,
  NES_PTR_ENEMY2,
  NES_PTR_ENEMY3,
  NES_PTR_ENEMY4,
  NES_PTR_EOF,
  NES_PTR_START,
  WORLDS,
} from './constants';
import type {
  ByteRange,
  EnemyBlock,
  EnemyItem,
  EnemyMap,
  EnemyPage,
  LevelSlotId,
} from './model';
import { levelSlotId } from './model';

/** Typed error raised on structurally invalid enemy data. */
export class EnemyParseError extends Error {
  constructor(
    message: string,
    readonly romOffset: number,
  ) {
    super(`${message} (ROM offset 0x${romOffset.toString(16)})`);
    this.name = 'EnemyParseError';
  }
}

function readU16LE(rom: Uint8Array, offset: number): number {
  const lo = rom[offset];
  const hi = rom[offset + 1];
  if (lo === undefined || hi === undefined) {
    throw new EnemyParseError('Read past ROM end', offset);
  }
  return (hi << 8) | lo;
}

function readByte(rom: Uint8Array, offset: number): number {
  const b = rom[offset];
  if (b === undefined) {
    throw new EnemyParseError('Read past ROM end', offset);
  }
  return b;
}

/**
 * Resolve the three-level indirection to obtain the ROM offset of the
 * enemy data block for each of the 210 slots. Returns offsets in slot
 * order (slot `w * LEVELS_PER_WORLD + l` at index `w * 10 + l`).
 */
function resolveEnemyPointers(rom: Uint8Array): number[] {
  const base0 = readU16LE(rom, NES_PTR_ENEMY1); // hi-table of hi-bytes
  const base1 = readU16LE(rom, NES_PTR_ENEMY2); // lo-table of hi-bytes
  const base2 = readU16LE(rom, NES_PTR_ENEMY3); // hi-table of lo-bytes
  const base3 = readU16LE(rom, NES_PTR_ENEMY4); // lo-table of lo-bytes

  const offsets: number[] = [];

  for (let w = 0; w < WORLDS; w++) {
    // Per-world: locate the hi-byte and lo-byte 10-element arrays.
    const worldHiArrLo = readByte(rom, w + base1 + DELTA_PTR);
    const worldHiArrHi = readByte(rom, w + base0 + DELTA_PTR);
    const worldHiArrCpu = (worldHiArrHi << 8) | worldHiArrLo;

    const worldLoArrLo = readByte(rom, w + base3 + DELTA_PTR);
    const worldLoArrHi = readByte(rom, w + base2 + DELTA_PTR);
    const worldLoArrCpu = (worldLoArrHi << 8) | worldLoArrLo;

    for (let l = 0; l < LEVELS_PER_WORLD; l++) {
      const loByte = readByte(rom, l + worldLoArrCpu + DELTA_PTR);
      const hiByte = readByte(rom, l + worldHiArrCpu + DELTA_PTR);
      const enemyCpu = (hiByte << 8) | loByte;
      offsets.push(enemyCpu + DELTA_PTR);
    }
  }

  if (offsets.length !== MAX_LEVELS) {
    throw new Error(
      `Expected ${MAX_LEVELS} enemy pointers, resolved ${offsets.length}`,
    );
  }
  return offsets;
}

/**
 * Compute the size in bytes of each unique enemy block using the C++
 * reference's pointer-difference heuristic. Blocks are sorted by ROM
 * offset ascending; each non-last block's size is the distance to the
 * next one. The last block is scanned forward for 0xFF (bounded by
 * NES_PTR_EOF and the buffer end).
 */
function computeBlockSizes(
  rom: Uint8Array,
  uniqueOffsets: ReadonlyArray<number>,
): Map<number, number> {
  if (uniqueOffsets.length === 0) return new Map();
  const sorted = [...uniqueOffsets].sort((a, b) => a - b);
  const sizes = new Map<number, number>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    sizes.set(current, next - current);
  }

  // Last block — scan for 0xFF sentinel.
  const last = sorted[sorted.length - 1]!;
  const boundary = Math.min(NES_PTR_EOF, rom.byteLength);
  let terminatorIdx = -1;
  for (let i = last; i < boundary; i++) {
    if (rom[i] === 0xff) {
      terminatorIdx = i;
      break;
    }
  }
  if (terminatorIdx === -1) {
    throw new EnemyParseError(
      'Last enemy block has no 0xFF terminator before end of region',
      last,
    );
  }
  sizes.set(last, terminatorIdx - last);

  return sizes;
}

/**
 * Parse a single enemy data block of known byte length into its pages.
 * Throws if the declared size does not pack cleanly into pages.
 */
export function parseEnemyBlock(
  rom: Uint8Array,
  romOffset: number,
  byteLength: number,
  referencingSlots: ReadonlyArray<LevelSlotId>,
): EnemyBlock {
  if (romOffset < NES_PTR_START || romOffset >= NES_PTR_EOF) {
    throw new EnemyParseError(
      'Enemy block starts outside the level-data region',
      romOffset,
    );
  }
  const end = romOffset + byteLength;
  if (end > rom.byteLength || end > NES_PTR_EOF) {
    throw new EnemyParseError(
      `Enemy block [${romOffset.toString(16)}..${end.toString(16)}) exceeds region`,
      romOffset,
    );
  }

  const pages: EnemyPage[] = [];
  let cursor = romOffset;

  while (cursor < end) {
    const sizeByte = rom[cursor]!;
    if ((sizeByte & 1) === 0) {
      // The reference tool always emits an odd size byte (1 + 2*N).
      // An even value means we have lost page alignment.
      throw new EnemyParseError(
        `Enemy page size byte must be odd, got 0x${sizeByte.toString(16)}`,
        cursor,
      );
    }
    const enemyCount = (sizeByte - 1) / 2;
    const pageEnd = cursor + 1 + enemyCount * 2;
    if (pageEnd > end) {
      throw new EnemyParseError(
        `Enemy page declares ${enemyCount} enemies but runs past block end`,
        cursor,
      );
    }

    const enemies: EnemyItem[] = [];
    for (let e = 0; e < enemyCount; e++) {
      const itemStart = cursor + 1 + e * 2;
      const id = rom[itemStart]!;
      const xy = rom[itemStart + 1]!;
      enemies.push({
        id,
        x: (xy >> 4) & 0x0f,
        y: xy & 0x0f,
        sourceBytes: rom.slice(itemStart, itemStart + 2),
        sourceRange: [itemStart, itemStart + 2],
      });
    }

    pages.push({
      sizeByte,
      enemies,
      sourceRange: [cursor, pageEnd],
    });
    cursor = pageEnd;
  }

  const sourceRange: ByteRange = [romOffset, end];
  return {
    romOffset,
    pages,
    byteLength,
    sourceRange,
    referencingSlots,
    isEdited: false,
  };
}

/**
 * Parse every unique enemy block in the ROM and produce the
 * slot → block index mapping.
 */
export function parseEnemyMap(rom: Uint8Array): EnemyMap {
  const slotOffsets = resolveEnemyPointers(rom);

  // Group slots by ROM offset (shared blocks).
  const slotsByOffset = new Map<number, LevelSlotId[]>();
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    const offset = slotOffsets[slot]!;
    const id = levelSlotId(slot);
    const bucket = slotsByOffset.get(offset);
    if (bucket === undefined) {
      slotsByOffset.set(offset, [id]);
    } else {
      bucket.push(id);
    }
  }

  const uniqueOffsets = [...slotsByOffset.keys()];
  const sizes = computeBlockSizes(rom, uniqueOffsets);

  // Preserve a deterministic block order: by the lowest slot that
  // references each block. Matches the convention used by the level
  // parser.
  const ordered = [...uniqueOffsets].sort((a, b) => {
    const slotsA = slotsByOffset.get(a)!;
    const slotsB = slotsByOffset.get(b)!;
    return slotsA[0]! - slotsB[0]!;
  });

  const blocks: EnemyBlock[] = [];
  const offsetToBlockIdx = new Map<number, number>();
  for (const offset of ordered) {
    const refs = slotsByOffset.get(offset)!;
    const size = sizes.get(offset)!;
    const block = parseEnemyBlock(rom, offset, size, refs);
    offsetToBlockIdx.set(offset, blocks.length);
    blocks.push(block);
  }

  const slotToBlock = slotOffsets.map(
    (offset) => offsetToBlockIdx.get(offset)!,
  );

  return { blocks, slotToBlock };
}
