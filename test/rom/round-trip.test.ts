/**
 * Round-trip gate — the single most load-bearing test in the project.
 *
 * Loads the canonical SMB2 USA PRG0 fixture, parses the full level map,
 * serializes it back in **conservative mode**, and asserts that every
 * physical level block's bytes in the output match the input exactly.
 *
 * Conservative mode re-emits each item's captured source bytes, so
 * byte-identity proves two things:
 *   1. The parser identified item boundaries correctly (wrong sizing
 *      would produce a misaligned concatenation).
 *   2. The parser identified level block boundaries correctly (it
 *      didn't truncate early or overread into adjacent data).
 *
 * This test requires the fixture at `test/fixtures/smb2.nes`. It skips
 * loudly when the fixture is absent so CI stays green without the ROM.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseLevelMap } from '@/rom/level-parser';
import { serializeLevelBlock } from '@/rom/level-serializer';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/smb2.nes');

function hasFixture(): boolean {
  return fs.existsSync(FIXTURE_PATH);
}

function loadRom(): Uint8Array {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe.skipIf(!hasFixture())('Level round-trip (conservative mode)', () => {
  it('parses every level block and re-emits it byte-identically', () => {
    const rom = loadRom();
    const map = parseLevelMap(rom);

    // Sanity checks on the shape of the parsed map.
    expect(map.slotToBlock).toHaveLength(210);
    expect(map.blocks.length).toBeGreaterThan(0);
    expect(map.blocks.length).toBeLessThanOrEqual(210);

    // At least one block must be shared (PRG0 uses level sharing).
    const hasSharing = map.blocks.some((b) => b.referencingSlots.length > 1);
    expect(hasSharing).toBe(true);

    // Every block's serialized bytes must match the ROM bytes in its range.
    const diffs: Array<{ blockIdx: number; range: [number, number] }> = [];
    for (let i = 0; i < map.blocks.length; i++) {
      const block = map.blocks[i]!;
      const serialized = serializeLevelBlock(block);
      const original = rom.subarray(
        block.sourceRange[0],
        block.sourceRange[1],
      );
      if (
        serialized.byteLength !== original.byteLength ||
        !serialized.every((b, idx) => b === original[idx])
      ) {
        diffs.push({ blockIdx: i, range: [...block.sourceRange] as [number, number] });
      }
    }

    if (diffs.length > 0) {
      throw new Error(
        `Round-trip mismatch in ${diffs.length} block(s): ` +
          diffs
            .slice(0, 5)
            .map(
              (d) =>
                `block#${d.blockIdx} [${d.range[0].toString(16)}..${d.range[1].toString(16)})`,
            )
            .join(', '),
      );
    }
    expect(diffs).toHaveLength(0);
  });

  it('leaves every non-level byte of the PRG-ROM untouched by a notional full repack', () => {
    // This is a weaker test that documents the invariant: outside the
    // level-data region [NES_PTR_START, NES_PTR_EOF), the PRG bytes
    // are not written by the level serializer. The full-ROM clone-and-
    // overlay test will land once the enemy/palette serializers exist
    // (Unit 5 / Unit 17). For now, we assert parse gives us blocks
    // whose source ranges stay inside the declared region.
    const rom = loadRom();
    const map = parseLevelMap(rom);

    for (const block of map.blocks) {
      expect(block.sourceRange[0]).toBeGreaterThanOrEqual(0x10010);
      expect(block.sourceRange[1]).toBeLessThanOrEqual(0x14010);
    }
  });
});

describe('Level round-trip (skipped without fixture)', () => {
  it.skipIf(hasFixture())('stub — skipped when the fixture is present', () => {
    // When the fixture is absent, report why so CI output is clear.
    expect(hasFixture()).toBe(false);
  });
});
