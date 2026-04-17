/**
 * NES palette reader — reads level palette data from the ROM.
 *
 * The ROM stores per-world palette tables. Each world has 8 palette
 * sets of 16 bytes (4 palettes × 4 NES color indices). The level
 * header's `palette` field (0-7) selects which set to use.
 *
 * ROM structure (from cpalette.cpp):
 *   - Pointer low bytes at ROM[0xC010 + world] (world 0-6)
 *   - Pointer high bytes at ROM[0xC01E + world]
 *   - Pointer = (hi << 8 | lo) + 0x4010 → ROM offset of 128-byte table
 *   - Table: 8 sets × 16 bytes = 128 bytes
 *   - Each set: [bg0,c1,c2,c3, bg0,c5,c6,c7, bg0,c9,cA,cB, bg0,cD,cE,cF]
 *     (bg0 = background color, repeated at index 0 of each 4-color palette)
 *
 * The NES master palette (64 colors) maps each index to an RGB value
 * via NES_PALETTE in nesleveldef.ts.
 */

import { NES_PALETTE } from './nesleveldef';

export interface LevelPalette {
  /** The 16 NES color indices (4 palettes × 4 colors). */
  readonly nesIndices: readonly number[];
  /** The 16 RGB colors derived from NES_PALETTE. */
  readonly colors: readonly [number, number, number][];
  /** The background color (palette 0, color 0). */
  readonly bgColor: readonly [number, number, number];
  /** CSS string for the background color. */
  readonly bgColorCss: string;
}

/**
 * Read the palette for a specific level from the ROM.
 *
 * @param rom - Full .nes ROM buffer.
 * @param slot - Level slot index (0-209).
 * @param paletteIndex - The level header's `palette` field (0-7).
 */
export function readLevelPalette(
  rom: Uint8Array,
  slot: number,
  paletteIndex: number,
): LevelPalette | null {
  const world = Math.floor(slot / 30);
  if (world < 0 || world >= 7) return null;

  const ptrLo = rom[0xc010 + world];
  const ptrHi = rom[0xc01e + world];
  if (ptrLo === undefined || ptrHi === undefined) return null;

  const paletteTableBase = ((ptrHi << 8) | ptrLo) + 0x4010;
  const setOffset = paletteTableBase + (paletteIndex & 7) * 16;

  const nesIndices: number[] = [];
  const colors: [number, number, number][] = [];

  for (let i = 0; i < 16; i++) {
    const nesIdx = rom[setOffset + i];
    if (nesIdx === undefined) return null;
    const idx = nesIdx & 0x3f; // NES palette is 64 entries
    nesIndices.push(idx);
    const rgb = NES_PALETTE[idx];
    colors.push(rgb ?? [0, 0, 0]);
  }

  const bgColor = colors[0] ?? [0, 0, 0];
  const bgColorCss = `rgb(${bgColor[0]}, ${bgColor[1]}, ${bgColor[2]})`;

  return { nesIndices, colors, bgColor, bgColorCss };
}
