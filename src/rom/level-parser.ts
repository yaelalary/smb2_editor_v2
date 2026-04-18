/**
 * SMB2 level parser — Unit 4.
 *
 * Produces a {@link LevelMap} from a validated ROM (the `rom` field of
 * a {@link ValidationSuccess}). Every structural decision mirrors the
 * reference C++ in `loginsinex/smb2`'s `cnesleveldata.cpp` so that the
 * conservative round-trip test stays byte-identical.
 *
 * Key invariants:
 *   - Pointer table location is resolved by double indirection from
 *     `NES_PTR_LEVELS1 / NES_PTR_LEVELS2`. Hardcoding the resolved
 *     offsets would work for PRG0 specifically, but mirroring the
 *     C++ resolution keeps the parser honest about its assumptions.
 *   - Level blocks are deduplicated by ROM offset. Multiple slots
 *     pointing to the same physical block produce a single `LevelBlock`
 *     with `referencingSlots.length > 1`.
 *   - Item byte lengths are determined exclusively from raw bytes —
 *     never from interpretive state like "current page" or "entrance
 *     context" — so the parser is a pure byte-stream walker. The
 *     interpreted model layer (for the UI) is built on top later.
 */

import {
  DELTA_PTR,
  ENTRANCE_ITEM_IDS,
  LEVEL_HEADER_BYTES,
  LEVEL_TERMINATOR,
  MAX_LEVELS,
  NES_PTR_LEVELS1,
  NES_PTR_LEVELS2,
  NES_PTR_START,
  NES_PTR_EOF,
} from './constants';
import type {
  ByteRange,
  LevelBlock,
  LevelHeader,
  LevelItem,
  LevelItemKind,
  LevelMap,
  LevelSlotId,
} from './model';
import { levelSlotId } from './model';

/** Typed error thrown when the ROM's level data is structurally invalid. */
export class LevelParseError extends Error {
  constructor(
    message: string,
    readonly romOffset: number,
  ) {
    super(`${message} (ROM offset 0x${romOffset.toString(16)})`);
    this.name = 'LevelParseError';
  }
}

/**
 * Read an unsigned 16-bit little-endian value from the ROM at the
 * given ROM offset.
 */
function readU16LE(rom: Uint8Array, offset: number): number {
  const lo = rom[offset];
  const hi = rom[offset + 1];
  if (lo === undefined || hi === undefined) {
    throw new LevelParseError('Read past ROM end', offset);
  }
  return (hi << 8) | lo;
}

/**
 * Resolve the pointer-to-pointer indirection to obtain ROM offsets of
 * the low-byte and high-byte level-pointer arrays.
 */
function resolvePointerArrays(rom: Uint8Array): {
  loOffset: number;
  hiOffset: number;
} {
  const loCpuAddr = readU16LE(rom, NES_PTR_LEVELS1);
  const hiCpuAddr = readU16LE(rom, NES_PTR_LEVELS2);
  return {
    loOffset: loCpuAddr + DELTA_PTR,
    hiOffset: hiCpuAddr + DELTA_PTR,
  };
}

/**
 * Decode the 4-byte big-endian level header into its bit-packed fields.
 * Bit positions traced from `cnesleveldata.cpp` StoreHeader(), with
 * `SWAP_DWORD` effectively giving us MSB-of-byte-0 as the highest bit.
 */
export function parseLevelHeader(bytes: Uint8Array): LevelHeader {
  if (bytes.byteLength !== LEVEL_HEADER_BYTES) {
    throw new Error(
      `Level header must be exactly ${LEVEL_HEADER_BYTES} bytes, got ${bytes.byteLength}`,
    );
  }
  const b0 = bytes[0]!;
  const b1 = bytes[1]!;
  const b2 = bytes[2]!;
  const b3 = bytes[3]!;

  const direction = (b0 >> 7) & 1;
  const palette = (b0 >> 3) & 0b111;
  const enemyColor = b0 & 0b11;
  const groundSet = b1 & 0b11111;
  const length = (b2 >> 4) & 0b1111;
  const objectType = b2 & 0b1111;
  const groundType = (b3 >> 3) & 0b111;
  const music = b3 & 0b11;

  // Reserved bits, packed MSB-first in disk order:
  // b0 bit 6, b0 bit 2, b1 bits 7-5, b3 bits 7-6, b3 bit 2.
  const reservedBits =
    (((b0 >> 6) & 1) << 7) |
    (((b0 >> 2) & 1) << 6) |
    (((b1 >> 5) & 0b111) << 3) |
    (((b3 >> 6) & 0b11) << 1) |
    ((b3 >> 2) & 1);

  return {
    direction,
    palette,
    enemyColor,
    groundSet,
    length,
    objectType,
    groundType,
    music,
    reservedBits,
    sourceBytes: bytes.slice(),
  };
}

interface ItemSizing {
  readonly kind: LevelItemKind;
  readonly size: number;
}

/**
 * Compute the kind and byte length of the item that starts at
 * `romOffset` inside `rom`. Pure byte-stream logic; never reads beyond
 * what the item's encoding requires.
 */
function sizeOfItem(rom: Uint8Array, romOffset: number): ItemSizing {
  const b0 = rom[romOffset];
  if (b0 === undefined) {
    throw new LevelParseError('Item starts at ROM end', romOffset);
  }

  const highNibble = (b0 >> 4) & 0x0f;
  const lowNibble = b0 & 0x0f;

  if (highNibble === 0x0f) {
    // Special operation dispatched by the low nibble.
    switch (lowNibble) {
      case 0x0:
      case 0x1:
        return { kind: 'groundSet', size: 2 };
      case 0x2:
      case 0x3:
        return { kind: 'skipper', size: 1 };
      case 0x4:
        return { kind: 'backToStart', size: 1 };
      case 0x5:
        return { kind: 'pointer', size: 3 };
      case 0x6:
        return { kind: 'groundType', size: 2 };
      // 0x7..0xE — C++ dispatches to a "default" branch that reads 2 bytes.
      // 0xF (= 0xFF) is the terminator and must be filtered out before this point.
      default:
        if (lowNibble === 0x0f) {
          throw new LevelParseError(
            'Encountered terminator (0xFF) in item dispatch — caller should have stopped',
            romOffset,
          );
        }
        return { kind: 'unknown', size: 2 };
    }
  }

  // Regular item or entrance. The ID byte sits at offset+1.
  const id = rom[romOffset + 1];
  if (id === undefined) {
    throw new LevelParseError(
      'Regular/entrance item missing its ID byte',
      romOffset,
    );
  }

  if (!ENTRANCE_ITEM_IDS.has(id)) {
    return { kind: 'regular', size: 2 };
  }

  // Entrance: inspect the next byte to decide its length.
  //   byte < 0xF0           → 4 bytes total (entrance + destination)
  //   byte == 0xF5          → 5 bytes total (entrance + extended destination)
  //   0xF0..0xFF except F5  → 2 bytes total (no destination, next item follows)
  const param = rom[romOffset + 2];
  if (param === undefined) {
    // End of region. No destination, treat as 2-byte entrance.
    return { kind: 'entrance', size: 2 };
  }
  if (param === 0xf5) return { kind: 'entrance', size: 5 };
  if (param >= 0xf0) return { kind: 'entrance', size: 2 };
  return { kind: 'entrance', size: 4 };
}

/**
 * Walk items and assign `tileX`, `tileY` using the cumulative cursor.
 * Same logic as `computeItemPositions` in `level-layout.ts` but writes
 * directly onto the parsed items rather than producing a separate array.
 */
function populateAbsolutePositions(items: LevelItem[], isHorizontal: boolean): void {
  let deltaX = 0;
  let deltaY = 0;

  for (const item of items) {
    switch (item.kind) {
      case 'skipper': {
        const lowNibble = item.sourceBytes[0]! & 0x0f;
        deltaY = 0;
        deltaX += (lowNibble - 1) * 0x10;
        break;
      }
      case 'backToStart':
        deltaX = 0;
        deltaY = 0;
        break;
      case 'regular':
      case 'entrance': {
        const byte0 = item.sourceBytes[0]!;
        const iy = (byte0 >> 4) & 0x0f;
        const ix = byte0 & 0x0f;
        deltaY += iy;
        if (deltaY >= 0x0f) {
          deltaY = (deltaY + 1) % 16;
          deltaX += 0x10;
        }
        // Mirrors C++ cneseditor_loader.cpp:57
        // POINT p = { fDir ? iDeltaX + x : x , fDir ? iDeltaY : iDeltaY + 0x0f*(iDeltaX/0x10) };
        if (isHorizontal) {
          item.tileX = deltaX + ix;
          item.tileY = deltaY;
        } else {
          item.tileX = ix;
          item.tileY = deltaY + 0x0f * Math.floor(deltaX / 0x10);
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Parse a single physical level block starting at `romOffset`.
 * Walks items until the 0xFF terminator; throws if the region ends
 * or the data region is exceeded before a terminator is found.
 */
export function parseLevelBlock(
  rom: Uint8Array,
  romOffset: number,
  referencingSlots: ReadonlyArray<LevelSlotId>,
): LevelBlock {
  if (romOffset < NES_PTR_START || romOffset >= NES_PTR_EOF) {
    throw new LevelParseError(
      'Level block starts outside the level data region',
      romOffset,
    );
  }

  const headerEnd = romOffset + LEVEL_HEADER_BYTES;
  if (headerEnd > rom.byteLength) {
    throw new LevelParseError(
      'Level header extends past ROM end',
      romOffset,
    );
  }
  const header = parseLevelHeader(rom.subarray(romOffset, headerEnd));

  const items: LevelItem[] = [];
  let cursor = headerEnd;
  const maxCursor = Math.min(rom.byteLength, NES_PTR_EOF);

  while (cursor < maxCursor) {
    const byte = rom[cursor]!;
    if (byte === LEVEL_TERMINATOR) {
      const end = cursor + 1;
      const sourceRange: ByteRange = [romOffset, end];
      // Populate absolute tile positions from the cumulative cursor.
      populateAbsolutePositions(items, header.direction === 1);

      return {
        romOffset,
        header,
        items,
        byteLength: end - romOffset,
        sourceRange,
        referencingSlots,
        isEdited: false,
      };
    }

    const { kind, size } = sizeOfItem(rom, cursor);
    const itemEnd = cursor + size;
    if (itemEnd > maxCursor) {
      throw new LevelParseError(
        `Item of kind ${kind} extends past level region`,
        cursor,
      );
    }
    const itemBytes = rom.slice(cursor, itemEnd);
    items.push({
      kind,
      sourceBytes: itemBytes,
      sourceRange: [cursor, itemEnd],
      tileX: -1,
      tileY: -1,
      itemId: itemBytes.byteLength > 1 ? itemBytes[1]! : -1,
    });
    cursor = itemEnd;
  }

  throw new LevelParseError(
    'Level stream ended without a 0xFF terminator',
    cursor,
  );
}

/**
 * Parse the full level map: resolve pointers, deduplicate blocks by
 * ROM offset, and produce the slot → block index mapping.
 */
export function parseLevelMap(rom: Uint8Array): LevelMap {
  const { loOffset, hiOffset } = resolvePointerArrays(rom);

  // Resolve each slot to its ROM offset.
  const slotRomOffsets: number[] = [];
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    const lo = rom[loOffset + slot];
    const hi = rom[hiOffset + slot];
    if (lo === undefined || hi === undefined) {
      throw new LevelParseError(
        `Pointer table truncated at slot ${slot}`,
        loOffset + slot,
      );
    }
    const cpuAddr = (hi << 8) | lo;
    slotRomOffsets.push(cpuAddr + DELTA_PTR);
  }

  // Group slots by ROM offset (shared blocks).
  const slotsByOffset = new Map<number, LevelSlotId[]>();
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    const offset = slotRomOffsets[slot]!;
    const bucket = slotsByOffset.get(offset);
    const id = levelSlotId(slot);
    if (bucket === undefined) {
      slotsByOffset.set(offset, [id]);
    } else {
      bucket.push(id);
    }
  }

  // Parse each unique block once. Preserve order by the lowest slot id
  // that references it — gives a deterministic iteration order.
  const orderedOffsets = [...slotsByOffset.keys()].sort((a, b) => {
    const slotsA = slotsByOffset.get(a)!;
    const slotsB = slotsByOffset.get(b)!;
    return slotsA[0]! - slotsB[0]!;
  });

  const blocks: LevelBlock[] = [];
  const offsetToBlockIdx = new Map<number, number>();
  for (const offset of orderedOffsets) {
    const refs = slotsByOffset.get(offset)!;
    const block = parseLevelBlock(rom, offset, refs);
    offsetToBlockIdx.set(offset, blocks.length);
    blocks.push(block);
  }

  const slotToBlock = slotRomOffsets.map(
    (offset) => offsetToBlockIdx.get(offset)!,
  );

  return { blocks, slotToBlock };
}
