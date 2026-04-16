import { describe, it, expect } from 'vitest';
import {
  LevelParseError,
  parseLevelBlock,
  parseLevelHeader,
} from '@/rom/level-parser';
import { serializeLevelBlock, packLevelHeader } from '@/rom/level-serializer';
import {
  LEVEL_TERMINATOR,
  NES_PTR_EOF,
  NES_PTR_START,
} from '@/rom/constants';
import { levelSlotId } from '@/rom/model';

/**
 * All tests in this file use synthetic byte buffers that mimic the
 * shape of the level data region. The fixture-dependent round-trip
 * over the real ROM lives in `round-trip.test.ts`.
 */

function emptyRegionBuffer(): Uint8Array {
  // 128 KiB PRG-sized buffer is overkill; NES_PTR_EOF is 0x14010.
  return new Uint8Array(NES_PTR_EOF + 0x100);
}

function writeBlockAt(
  rom: Uint8Array,
  romOffset: number,
  blockBytes: Uint8Array,
): void {
  rom.set(blockBytes, romOffset);
}

const HEADER_PRG0_1_1 = new Uint8Array([0x80, 0x00, 0x30, 0x00]);

describe('parseLevelHeader', () => {
  it('extracts every field from a known header', () => {
    // b0 = 0x80 → direction=1, palette=0, enemyColor=0
    // b1 = 0x00 → groundSet=0
    // b2 = 0x30 → length=3, objectType=0
    // b3 = 0x00 → groundType=0, music=0
    const header = parseLevelHeader(HEADER_PRG0_1_1);
    expect(header.direction).toBe(1);
    expect(header.palette).toBe(0);
    expect(header.enemyColor).toBe(0);
    expect(header.groundSet).toBe(0);
    expect(header.length).toBe(3);
    expect(header.objectType).toBe(0);
    expect(header.groundType).toBe(0);
    expect(header.music).toBe(0);
    expect(header.reservedBits).toBe(0);
    expect(header.sourceBytes).toEqual(HEADER_PRG0_1_1);
  });

  it('decodes every field at its max value', () => {
    // Direction=1, palette=7, enemyColor=3 → b0 = 1_0_111_0_11 = 0xBB
    // reserved3 all 1s + groundSet=31 → b1 = 111_11111 = 0xFF
    // length=15, objectType=15 → b2 = 1111_1111 = 0xFF
    // reserved4 all 1s + groundType=7 + reserved5=1 + music=3 → b3 = 11_111_1_11 = 0xFF
    const header = parseLevelHeader(new Uint8Array([0xbb, 0xff, 0xff, 0xff]));
    expect(header.direction).toBe(1);
    expect(header.palette).toBe(7);
    expect(header.enemyColor).toBe(3);
    expect(header.groundSet).toBe(31);
    expect(header.length).toBe(15);
    expect(header.objectType).toBe(15);
    expect(header.groundType).toBe(7);
    expect(header.music).toBe(3);
    // Reserved bits: b0 bit 6 = 0, b0 bit 2 = 0, b1 bits 7-5 = 111,
    // b3 bits 7-6 = 11, b3 bit 2 = 1. Packed: 00 111 11 1 = 0b00111111 = 0x3F
    expect(header.reservedBits).toBe(0x3f);
  });

  it('throws on wrong-length input', () => {
    expect(() => parseLevelHeader(new Uint8Array(3))).toThrow(/4 bytes/);
    expect(() => parseLevelHeader(new Uint8Array(5))).toThrow(/4 bytes/);
  });

  it('constructive round-trip: parse → pack → byte-identical for known header', () => {
    const header = parseLevelHeader(HEADER_PRG0_1_1);
    const packed = packLevelHeader(header);
    expect(Array.from(packed)).toEqual(Array.from(HEADER_PRG0_1_1));
  });

  it('constructive round-trip: parse → pack → byte-identical for all-max-values header', () => {
    const raw = new Uint8Array([0xbb, 0xff, 0xff, 0xff]);
    const header = parseLevelHeader(raw);
    const packed = packLevelHeader(header);
    expect(Array.from(packed)).toEqual(Array.from(raw));
  });

  it('constructive round-trip: parse → pack → byte-identical for all-zero header', () => {
    const raw = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    const header = parseLevelHeader(raw);
    const packed = packLevelHeader(header);
    expect(Array.from(packed)).toEqual(Array.from(raw));
  });

  it('constructive round-trip: parse → pack → byte-identical with mixed reserved bits', () => {
    // b0=0x44 (reserved bit 6 set, reserved bit 2 set), b1=0xE0 (reserved 7-5 set),
    // b2=0x00, b3=0xC4 (reserved bits 7-6 set, reserved bit 2 set)
    const raw = new Uint8Array([0x44, 0xe0, 0x00, 0xc4]);
    const header = parseLevelHeader(raw);
    const packed = packLevelHeader(header);
    expect(Array.from(packed)).toEqual(Array.from(raw));
  });
});

describe('parseLevelBlock — edge cases', () => {
  it('parses a minimal empty level (header + terminator, no items)', () => {
    const offset = NES_PTR_START + 0x100;
    const blockBytes = new Uint8Array([...HEADER_PRG0_1_1, LEVEL_TERMINATOR]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block = parseLevelBlock(rom, offset, [levelSlotId(0)]);
    expect(block.items).toHaveLength(0);
    expect(block.byteLength).toBe(5);
    expect(block.sourceRange).toEqual([offset, offset + 5]);
    expect(block.referencingSlots).toEqual([levelSlotId(0)]);

    // Conservative round-trip.
    const out = serializeLevelBlock(block);
    expect(Array.from(out)).toEqual(Array.from(blockBytes));
  });

  it('parses a level with a single pointer item (3 bytes)', () => {
    const offset = NES_PTR_START + 0x200;
    // 0xF5 = pointer kind (special-op), followed by 2 parameter bytes.
    const blockBytes = new Uint8Array([
      ...HEADER_PRG0_1_1,
      0xf5,
      0x12,
      0x34,
      LEVEL_TERMINATOR,
    ]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block = parseLevelBlock(rom, offset, [levelSlotId(1)]);
    expect(block.items).toHaveLength(1);
    expect(block.items[0]!.kind).toBe('pointer');
    expect(block.items[0]!.sourceBytes.byteLength).toBe(3);
    expect(Array.from(block.items[0]!.sourceBytes)).toEqual([0xf5, 0x12, 0x34]);

    const out = serializeLevelBlock(block);
    expect(Array.from(out)).toEqual(Array.from(blockBytes));
  });

  it('parses an entrance item with a regular parameter byte (4 bytes)', () => {
    const offset = NES_PTR_START + 0x300;
    // Position byte (any high nibble != 0xF), entrance id 0x09 (locked door),
    // then a parameter byte < 0xF0 triggers the 4-byte variant + 1 more byte.
    const blockBytes = new Uint8Array([
      ...HEADER_PRG0_1_1,
      0x20,
      0x09,
      0x42,
      0x55,
      LEVEL_TERMINATOR,
    ]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block = parseLevelBlock(rom, offset, [levelSlotId(2)]);
    expect(block.items).toHaveLength(1);
    expect(block.items[0]!.kind).toBe('entrance');
    expect(block.items[0]!.sourceBytes.byteLength).toBe(4);
    expect(Array.from(block.items[0]!.sourceBytes)).toEqual([0x20, 0x09, 0x42, 0x55]);

    const out = serializeLevelBlock(block);
    expect(Array.from(out)).toEqual(Array.from(blockBytes));
  });

  it('parses an entrance item with 0xF5 parameter (5-byte variant)', () => {
    const offset = NES_PTR_START + 0x400;
    const blockBytes = new Uint8Array([
      ...HEADER_PRG0_1_1,
      0x20,
      0x09,
      0xf5,
      0x11,
      0x22,
      LEVEL_TERMINATOR,
    ]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block = parseLevelBlock(rom, offset, [levelSlotId(3)]);
    expect(block.items).toHaveLength(1);
    expect(block.items[0]!.kind).toBe('entrance');
    expect(block.items[0]!.sourceBytes.byteLength).toBe(5);

    const out = serializeLevelBlock(block);
    expect(Array.from(out)).toEqual(Array.from(blockBytes));
  });

  it('parses an entrance with special-op byte following (2-byte no-destination variant)', () => {
    const offset = NES_PTR_START + 0x500;
    // Entrance position + id 0x09, followed by 0xF0 (ground-set command).
    // That indicates this entrance has no destination; the 0xF0 starts a new item.
    const blockBytes = new Uint8Array([
      ...HEADER_PRG0_1_1,
      0x20,
      0x09,
      0xf0,
      0x07,
      LEVEL_TERMINATOR,
    ]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block = parseLevelBlock(rom, offset, [levelSlotId(4)]);
    expect(block.items).toHaveLength(2);
    expect(block.items[0]!.kind).toBe('entrance');
    expect(block.items[0]!.sourceBytes.byteLength).toBe(2);
    expect(block.items[1]!.kind).toBe('groundSet');
    expect(block.items[1]!.sourceBytes.byteLength).toBe(2);

    const out = serializeLevelBlock(block);
    expect(Array.from(out)).toEqual(Array.from(blockBytes));
  });

  it('parses a mix of regular, skipper, and back-to-start items', () => {
    const offset = NES_PTR_START + 0x600;
    const blockBytes = new Uint8Array([
      ...HEADER_PRG0_1_1,
      0x00,
      0x01, // regular item (2 bytes)
      0xf2, // skipper (1 byte)
      0xf4, // back-to-start (1 byte)
      0xf6,
      0x05, // groundType (2 bytes)
      LEVEL_TERMINATOR,
    ]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block = parseLevelBlock(rom, offset, [levelSlotId(5)]);
    expect(block.items.map((i) => i.kind)).toEqual([
      'regular',
      'skipper',
      'backToStart',
      'groundType',
    ]);

    const out = serializeLevelBlock(block);
    expect(Array.from(out)).toEqual(Array.from(blockBytes));
  });

  it('two-pass round-trip: parse → serialize → parse → serialize byte-identity', () => {
    const offset = NES_PTR_START + 0x700;
    const blockBytes = new Uint8Array([
      ...HEADER_PRG0_1_1,
      0x00,
      0x01,
      0xf5,
      0xab,
      0xcd,
      0xf2,
      0x10,
      0x05,
      0xf6,
      0x03,
      LEVEL_TERMINATOR,
    ]);
    const rom = emptyRegionBuffer();
    writeBlockAt(rom, offset, blockBytes);

    const block1 = parseLevelBlock(rom, offset, [levelSlotId(6)]);
    const bytes1 = serializeLevelBlock(block1);

    // Feed bytes1 back through the parser by staging them in a fresh rom.
    const rom2 = emptyRegionBuffer();
    writeBlockAt(rom2, offset, bytes1);
    const block2 = parseLevelBlock(rom2, offset, [levelSlotId(6)]);
    const bytes2 = serializeLevelBlock(block2);

    expect(Array.from(bytes2)).toEqual(Array.from(blockBytes));
  });
});

describe('parseLevelBlock — error paths', () => {
  it('throws LevelParseError with the offset when the 0xFF terminator is missing', () => {
    const offset = NES_PTR_START + 0x800;
    const rom = emptyRegionBuffer();
    // Fill the region after our header with legitimate 2-byte regular
    // items, no terminator ever.
    rom.set(HEADER_PRG0_1_1, offset);
    for (let i = offset + 4; i < NES_PTR_EOF - 1; i += 2) {
      rom[i] = 0x00;
      rom[i + 1] = 0x01;
    }

    expect(() =>
      parseLevelBlock(rom, offset, [levelSlotId(7)]),
    ).toThrow(LevelParseError);
  });

  it('refuses a block whose offset is outside the level data region', () => {
    const rom = emptyRegionBuffer();
    rom.set(HEADER_PRG0_1_1, 0x100);
    rom[0x104] = LEVEL_TERMINATOR;

    expect(() =>
      parseLevelBlock(rom, 0x100, [levelSlotId(8)]),
    ).toThrow(LevelParseError);
  });
});
