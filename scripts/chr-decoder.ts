/**
 * NES CHR tile decoder.
 *
 * Pure function: takes 16 raw CHR bytes (one tile) and returns an 8x8
 * matrix of 2-bit color indices (0..3). No I/O, no side effects — this
 * module is consumed both by the build-time extraction script
 * (`scripts/extract-chr.ts`) and by tests.
 *
 * CHR format per the NESDev wiki:
 *   https://www.nesdev.org/wiki/PPU_pattern_tables
 *
 *   - Each tile is exactly 16 bytes.
 *   - bytes[0..7]  = bitplane 0 (low bit of the color index)
 *   - bytes[8..15] = bitplane 1 (high bit)
 *   - Within a byte, bit 7 is the leftmost pixel (column 0).
 *
 * This module owns the bit-twiddling. Palette application (turning the
 * 0..3 index into a concrete color) is deliberately *not* done here —
 * the extraction script emits grayscale PNGs, and runtime code
 * re-colors based on the level's active NES palette.
 */

/** Bytes per tile in the NES CHR format. */
export const TILE_BYTES = 16;

/** Pixels per tile edge (tiles are always 8x8). */
export const TILE_SIZE = 8;

/**
 * Decode a single 16-byte CHR tile into an 8-row matrix of 8 color
 * indices each (values 0..3).
 *
 * @throws if `bytes` is not exactly 16 bytes long.
 */
export function decodeTile(bytes: Uint8Array): number[][] {
  if (bytes.length !== TILE_BYTES) {
    throw new Error(
      `CHR tile must be exactly ${TILE_BYTES} bytes, got ${bytes.length}`,
    );
  }

  const pixels: number[][] = [];
  for (let row = 0; row < TILE_SIZE; row++) {
    const lowByte = bytes[row]!;
    const highByte = bytes[row + TILE_SIZE]!;
    const rowPixels: number[] = [];

    for (let col = 0; col < TILE_SIZE; col++) {
      const shift = TILE_SIZE - 1 - col; // bit 7 → col 0, bit 0 → col 7
      const low = (lowByte >> shift) & 1;
      const high = (highByte >> shift) & 1;
      rowPixels.push((high << 1) | low);
    }

    pixels.push(rowPixels);
  }

  return pixels;
}

/**
 * Decode a contiguous buffer of CHR bytes into an array of tile pixel
 * matrices. The buffer length must be a multiple of 16; partial tiles
 * are an error.
 */
export function decodeAllTiles(chrBytes: Uint8Array): number[][][] {
  if (chrBytes.length % TILE_BYTES !== 0) {
    throw new Error(
      `CHR buffer length ${chrBytes.length} is not a multiple of ${TILE_BYTES}`,
    );
  }

  const tileCount = chrBytes.length / TILE_BYTES;
  const tiles: number[][][] = [];

  for (let i = 0; i < tileCount; i++) {
    const start = i * TILE_BYTES;
    tiles.push(decodeTile(chrBytes.subarray(start, start + TILE_BYTES)));
  }

  return tiles;
}
