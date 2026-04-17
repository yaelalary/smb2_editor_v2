/**
 * SetPaletteColorCommand — Unit 17.
 *
 * Mutates a single NES color index in the ROM's per-world palette table.
 * The palette data lives directly in ROM bytes at a pointer-resolved
 * offset (same addresses as palette-reader.ts).
 */

import type { Command } from './types';

export class SetPaletteColorCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly rom: Uint8Array;
  private readonly romOffset: number;
  private readonly oldValue: number;
  private readonly newValue: number;

  /**
   * @param rom        - The ROM Uint8Array (mutable reference from store).
   * @param romOffset  - Absolute byte offset in ROM of the palette entry.
   * @param newValue   - New NES color index (0-63).
   * @param slotHint   - Optional slot for undo notification context.
   * @param colorLabel - Human-readable description (e.g. "World 1, set 0, color 5").
   */
  constructor(
    rom: Uint8Array,
    romOffset: number,
    newValue: number,
    slotHint: number | undefined,
    colorLabel: string,
  ) {
    this.rom = rom;
    this.romOffset = romOffset;
    this.oldValue = rom[romOffset]!;
    this.newValue = newValue & 0x3f; // NES palette is 6-bit
    this.targetSlot = slotHint;
    this.label = `Change palette color (${colorLabel})`;
  }

  execute(): void {
    this.rom[this.romOffset] = this.newValue;
  }

  undo(): void {
    this.rom[this.romOffset] = this.oldValue;
  }
}
