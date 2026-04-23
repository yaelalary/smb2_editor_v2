/**
 * Registry of runtime ground physics per tile ID and world.
 *
 * SMB2's 6502 engine decides how Mario interacts with the ground by
 * reading the tile ID under his feet and consulting a hardcoded table:
 * some tiles are solid, some are diggable (B+Down to descend), some are
 * quicksand (Mario sinks, rises on jump — lets him pass under walls,
 * e.g. level 6-3·2 zone 2). **This behavior is not stored in the level
 * data** — it's a property of the (world, tileId) pair.
 *
 * The C++ reference tool (loginsinex/smb2) does not surface these
 * distinctions anywhere in its UI — verified in `cbgtiles.cpp`,
 * `cmiscdatadlg.cpp`, `cneseditor_tiles.cpp`. The knowledge is tribal:
 * only identifiable by playing vanilla levels in an emulator and
 * correlating each zone's rendered tile ID (via `getBgTile`) with the
 * observed behavior.
 *
 * This registry is populated manually as those observations are made.
 * Same pattern as `boss-exit-doors.ts` — a table maintained by the
 * level designer, not derived from ROM data.
 *
 * To add an entry:
 *   1. Open a level with known physics in the editor.
 *   2. Find the ground zone and its `groundSet` + `groundType`.
 *   3. Compute the rendered tile ID: `getBgTile(rom, bgSet, groundType,
 *      world, isH)` for each `bgSet` in 1..3 that the shape produces.
 *   4. Add one entry per (world, tileId, physics) combo.
 */

import { getBgSet, getBgTile } from './tile-reader';

export type GroundPhysics = 'solid' | 'diggable' | 'quicksand';

export interface PhysicsEntry {
  /** World index, 0..6 (matches `Math.floor(slot / 30)`). */
  readonly world: number;
  /** Level header's `objectType` field (4 bits, 0..15). The same tile
   *  can mean different physics in different objectType levels — e.g.
   *  in World 6, tile 0xA0 is quicksand when objectType=0 but diggable
   *  when objectType=2. Key on this to disambiguate. */
  readonly objectType: number;
  /** Tile ID emitted by `getBgTile` for some (bgSet, groundType, isH). */
  readonly tileId: number;
  /** Runtime behavior in the game engine. */
  readonly physics: GroundPhysics;
  /** Where this was confirmed — helps future editors verify/extend. */
  readonly notes?: string;
}

/**
 * Known physics entries. Add more as behaviors are confirmed in-game.
 * Empty registry = all zones render as 'solid' (the safe default),
 * so the feature degrades silently instead of lying about behavior.
 *
 * Seeds populated via `scripts/identify-ground-physics.ts` from the
 * vanilla ROM fixture.
 */
export const GROUND_PHYSICS: ReadonlyArray<PhysicsEntry> = [
  // World 6, objectType=0 — quicksand theme. After the groundType retro-
  // update fix in ground-pass.ts, both 6-3·2 and 6-1·1 zone 2 resolve
  // to tile 0x8A (not 0x99/0xA0 as before the fix).
  { world: 5, objectType: 0, tileId: 0x8a, physics: 'quicksand', notes: 'confirmed in 6-3·2 zone 2 and 6-1·1 zone 2' },
  // World 6, objectType=2 — diggable theme.
  { world: 5, objectType: 2, tileId: 0xa0, physics: 'diggable', notes: 'confirmed in 6-3·3 zone 5' },
];

/** Look up the physics for a single tile ID in a given (world, objectType). */
export function physicsForTile(
  world: number,
  objectType: number,
  tileId: number,
): GroundPhysics {
  return (
    GROUND_PHYSICS.find(
      (e) => e.world === world && e.objectType === objectType && e.tileId === tileId,
    )?.physics ?? 'solid'
  );
}

/**
 * Physics of a whole ground zone. Walks the shape's 15-row bitmask,
 * collects the bitsets actually painted (1..3, skipping 0 = hole),
 * resolves each to a tile ID via `getBgTile`, and returns the first
 * non-`'solid'` physics found. Returns `'solid'` if nothing is known —
 * the label then stays silent for that zone.
 */
export function physicsForZone(
  rom: Uint8Array,
  world: number,
  objectType: number,
  groundSet: number,
  groundType: number,
  isH: boolean,
): GroundPhysics {
  const dw = getBgSet(rom, groundSet & 0x1f, isH);
  const usedBitsets = new Set<number>();
  for (let i = 0; i < 15; i++) {
    const bitset = (dw >>> (30 - i * 2)) & 0x03;
    if (bitset !== 0) usedBitsets.add(bitset);
  }
  for (const bs of usedBitsets) {
    const tileId = getBgTile(rom, bs, groundType, world, isH);
    if (tileId === 0xff) continue;
    const p = physicsForTile(world, objectType, tileId);
    if (p !== 'solid') return p;
  }
  return 'solid';
}
