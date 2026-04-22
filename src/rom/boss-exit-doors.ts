/**
 * Hardcoded registry of post-boss exit doors.
 *
 * In vanilla SMB2, after defeating a boss (Mouser, Triclyde, Fryguy,
 * Clawgrip, Wart, and every Birdo mini-boss), a White entrance sprite
 * appears in the room so Mario can exit. **This door is not stored in
 * the level's item stream** — its position is a literal constant in
 * the ROM's 6502 ASM that runs on boss defeat. The reference C++ tool
 * (loginsinex/smb2) doesn't expose it either.
 *
 * To surface it in our editor we keep a manual map here. Each entry is
 * gathered by playing vanilla SMB2 USA PRG0 in an emulator, observing
 * where the door appears, and reading the tile coords out of the
 * editor (place a White entrance on that tile, look at the Inspector).
 *
 * The LevelCanvas paints a semi-transparent ghost of item 21 at the
 * recorded position so the level designer can see it. Overlay is
 * read-only — editing would require ROM ASM patching, out of scope.
 */

export interface BossExitDoor {
  /** Slot id (0..209) of the boss room. */
  readonly slot: number;
  /** Top-left tile of the White entrance sprite (same convention as
   *  placed items: the tile shown in the Inspector's `Position (X, Y)`). */
  readonly tileX: number;
  readonly tileY: number;
  /** Name of the boss whose defeat spawns this door — used in the
   *  overlay label so the user knows which enemy to beat. */
  readonly bossName: string;
}

/**
 * Known boss exit doors for vanilla SMB2 USA PRG0.
 *
 * To add an entry: play the room in an emulator, beat the boss, note
 * the tile where the White entrance sprite lands, then drag a White
 * entrance onto that tile in the editor and copy the Inspector's
 * `Position (X, Y)` into a new object below.
 */
export const BOSS_EXIT_DOORS: ReadonlyArray<BossExitDoor> = [
  { slot: 24, tileX: 24, tileY: 11, bossName: 'Mouser' }, // 1-3·5
];

/** Lookup the boss exit door registered for a slot, or null. */
export function bossExitDoorForSlot(slot: number): BossExitDoor | null {
  return BOSS_EXIT_DOORS.find((d) => d.slot === slot) ?? null;
}
