import { describe, it, expect } from 'vitest';
import { decodeTile, TILE_BYTES, TILE_SIZE } from '../../scripts/chr-decoder';

/**
 * NES CHR format recap:
 *   - One tile = 16 bytes = two 8-byte bitplanes
 *   - bytes[0..7]   = bitplane 0 (low bit of each 2-bit color index)
 *   - bytes[8..15]  = bitplane 1 (high bit)
 *   - Within a byte, bit 7 is the leftmost pixel (column 0)
 *   - Per-pixel color index = (high << 1) | low, range 0..3
 *
 * Reference: https://www.nesdev.org/wiki/PPU_pattern_tables
 */
describe('decodeTile', () => {
  it('exposes the expected tile dimensions', () => {
    expect(TILE_BYTES).toBe(16);
    expect(TILE_SIZE).toBe(8);
  });

  it('decodes an all-zero tile to an all-zero 8x8 matrix', () => {
    const tile = new Uint8Array(TILE_BYTES);
    const pixels = decodeTile(tile);

    expect(pixels).toHaveLength(TILE_SIZE);
    for (const row of pixels) {
      expect(row).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it('decodes an all-ones tile (both bitplanes 0xFF) to an all-3 matrix', () => {
    const tile = new Uint8Array(TILE_BYTES).fill(0xff);
    const pixels = decodeTile(tile);

    for (const row of pixels) {
      expect(row).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    }
  });

  it('produces color index 1 when only the low bitplane is set', () => {
    const tile = new Uint8Array(TILE_BYTES);
    for (let i = 0; i < 8; i++) tile[i] = 0xff;

    const pixels = decodeTile(tile);
    for (const row of pixels) {
      expect(row).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    }
  });

  it('produces color index 2 when only the high bitplane is set', () => {
    const tile = new Uint8Array(TILE_BYTES);
    for (let i = 8; i < 16; i++) tile[i] = 0xff;

    const pixels = decodeTile(tile);
    for (const row of pixels) {
      expect(row).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
    }
  });

  it('combines bitplanes correctly for an alternating pattern', () => {
    // Row 0: low=0b10101010 (0xAA), high=0b01010101 (0x55)
    // Column-by-column (bit 7 first → column 0):
    //   col 0: low=1, high=0 → 1
    //   col 1: low=0, high=1 → 2
    //   col 2: low=1, high=0 → 1
    //   col 3: low=0, high=1 → 2
    //   ... alternating 1, 2
    const tile = new Uint8Array(TILE_BYTES);
    tile[0] = 0xaa;
    tile[8] = 0x55;

    const pixels = decodeTile(tile);

    expect(pixels[0]).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    for (let r = 1; r < TILE_SIZE; r++) {
      expect(pixels[r]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it('decodes each row independently — row 3 only', () => {
    // Put a known pattern only in row 3.
    const tile = new Uint8Array(TILE_BYTES);
    tile[3] = 0b11110000; // low bitplane row 3
    tile[11] = 0b11001100; // high bitplane row 3

    const pixels = decodeTile(tile);

    // Row 3 per column (bit 7 first):
    //   c0: low=1, high=1 → 3
    //   c1: low=1, high=1 → 3
    //   c2: low=1, high=0 → 1
    //   c3: low=1, high=0 → 1
    //   c4: low=0, high=1 → 2
    //   c5: low=0, high=1 → 2
    //   c6: low=0, high=0 → 0
    //   c7: low=0, high=0 → 0
    expect(pixels[3]).toEqual([3, 3, 1, 1, 2, 2, 0, 0]);

    // Other rows untouched.
    for (let r = 0; r < TILE_SIZE; r++) {
      if (r === 3) continue;
      expect(pixels[r]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it('throws when input is shorter than 16 bytes', () => {
    expect(() => decodeTile(new Uint8Array(15))).toThrow(/16 bytes/);
  });

  it('throws when input is longer than 16 bytes', () => {
    expect(() => decodeTile(new Uint8Array(17))).toThrow(/16 bytes/);
  });

  it('is a pure function — decoding twice yields equal output', () => {
    const tile = new Uint8Array(TILE_BYTES);
    for (let i = 0; i < 16; i++) tile[i] = i * 17;

    const a = decodeTile(tile);
    const b = decodeTile(tile);
    expect(a).toEqual(b);
  });
});
