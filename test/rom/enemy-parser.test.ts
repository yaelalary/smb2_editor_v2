import { describe, it, expect } from 'vitest';
import { EnemyParseError, parseEnemyBlock } from '@/rom/enemy-parser';
import { serializeEnemyBlock } from '@/rom/enemy-serializer';
import { NES_PTR_EOF, NES_PTR_START } from '@/rom/constants';
import { levelSlotId } from '@/rom/model';

/**
 * Enemy block parsing is page-sequential: size_byte = 1 + 2*N, then N
 * enemy entries of 2 bytes (id + packed x/y). Block length comes from
 * outside (pointer-difference heuristic); these tests feed a known
 * length and a synthetic buffer, exercising just the inner page walk.
 */

function emptyRegionBuffer(): Uint8Array {
  return new Uint8Array(NES_PTR_EOF + 0x100);
}

describe('parseEnemyBlock — page walking', () => {
  it('parses a block with a single empty page (size byte 0x01)', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x10;
    rom[offset] = 0x01;

    const block = parseEnemyBlock(rom, offset, 1, [levelSlotId(0)]);
    expect(block.pages).toHaveLength(1);
    expect(block.pages[0]!.sizeByte).toBe(0x01);
    expect(block.pages[0]!.enemies).toHaveLength(0);
    expect(block.byteLength).toBe(1);
    expect(block.referencingSlots).toEqual([levelSlotId(0)]);
  });

  it('parses a block with one page carrying one enemy', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x20;
    rom.set([0x03, 0x42, 0x35], offset);
    // size 0x03 → 1 enemy; id=0x42, xy=0x35 → x=3, y=5

    const block = parseEnemyBlock(rom, offset, 3, [levelSlotId(1)]);
    expect(block.pages).toHaveLength(1);
    expect(block.pages[0]!.enemies).toHaveLength(1);
    expect(block.pages[0]!.enemies[0]!.id).toBe(0x42);
    expect(block.pages[0]!.enemies[0]!.x).toBe(3);
    expect(block.pages[0]!.enemies[0]!.y).toBe(5);
    expect(Array.from(block.pages[0]!.enemies[0]!.sourceBytes)).toEqual([0x42, 0x35]);
  });

  it('parses a block with multiple pages of varying enemy counts', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x40;
    const bytes = [
      0x01, // page 0: empty
      0x05, 0x10, 0x01, 0x20, 0x22, // page 1: 2 enemies
      0x03, 0x30, 0x4a, // page 2: 1 enemy
    ];
    rom.set(bytes, offset);

    const block = parseEnemyBlock(rom, offset, bytes.length, [levelSlotId(2)]);
    expect(block.pages).toHaveLength(3);
    expect(block.pages.map((p) => p.enemies.length)).toEqual([0, 2, 1]);
    expect(block.pages[1]!.enemies[0]!.id).toBe(0x10);
    expect(block.pages[1]!.enemies[0]!.x).toBe(0);
    expect(block.pages[1]!.enemies[0]!.y).toBe(1);
    expect(block.pages[2]!.enemies[0]!.x).toBe(4);
    expect(block.pages[2]!.enemies[0]!.y).toBe(0xa);
  });

  it('throws when a size byte is even (lost alignment)', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x60;
    rom[offset] = 0x02; // invalid

    expect(() =>
      parseEnemyBlock(rom, offset, 1, [levelSlotId(3)]),
    ).toThrow(EnemyParseError);
  });

  it('throws when a page declares more enemies than fit in the block', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x70;
    rom[offset] = 0x05; // declares 2 enemies = 4 bytes, but we only give 1 byte

    expect(() =>
      parseEnemyBlock(rom, offset, 1, [levelSlotId(4)]),
    ).toThrow(/runs past block end/);
  });

  it('refuses a block whose offset is outside the level-data region', () => {
    const rom = emptyRegionBuffer();
    rom[0x1000] = 0x01;

    expect(() =>
      parseEnemyBlock(rom, 0x1000, 1, [levelSlotId(5)]),
    ).toThrow(EnemyParseError);
  });

  it('conservative round-trip: bytes in = bytes out for a realistic mix', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x100;
    const bytes = new Uint8Array([
      0x01, // empty page
      0x07, 0x10, 0x03, 0x15, 0x27, 0x20, 0x48, // 3 enemies
      0x01, // another empty page
      0x03, 0xff, 0x00, // 1 enemy (id=0xFF is legal inside an entry)
    ]);
    rom.set(bytes, offset);

    const block = parseEnemyBlock(rom, offset, bytes.length, [levelSlotId(6)]);
    const out = serializeEnemyBlock(block);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });
});

describe('serializeEnemyBlock — bookkeeping', () => {
  it('writes exactly byteLength bytes even for a many-page block', () => {
    const rom = emptyRegionBuffer();
    const offset = NES_PTR_START + 0x200;
    // 10 pages × 0x01 (empty) = 10 bytes.
    const bytes = new Uint8Array(10).fill(0x01);
    rom.set(bytes, offset);

    const block = parseEnemyBlock(rom, offset, 10, [levelSlotId(7)]);
    const out = serializeEnemyBlock(block);
    expect(out.byteLength).toBe(10);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });
});
