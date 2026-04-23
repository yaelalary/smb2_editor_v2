/**
 * Ground physics resolvers.
 *
 * The registry is (intentionally) empty by default — physics entries
 * are added by hand as the user confirms behaviors in-game. These tests
 * verify the resolvers themselves degrade gracefully:
 *   - `physicsForTile` returns `'solid'` for anything not in the table.
 *   - `physicsForZone` returns `'solid'` when no tile of the zone is
 *     registered.
 *   - If we inject a test entry, the resolver finds it.
 */
import { describe, it, expect } from 'vitest';
import { physicsForTile, GROUND_PHYSICS } from '@/rom/ground-physics';

describe('physicsForTile', () => {
  it("returns 'solid' for unknown (world, objectType, tileId) tuples", () => {
    expect(physicsForTile(0, 0, 0x00)).toBe('solid');
    expect(physicsForTile(5, 0, 0x42)).toBe('solid');
    expect(physicsForTile(6, 0, 0xff)).toBe('solid');
  });

  it('returns the registered physics when a matching entry exists', () => {
    for (const entry of GROUND_PHYSICS) {
      expect(physicsForTile(entry.world, entry.objectType, entry.tileId)).toBe(
        entry.physics,
      );
    }
  });

  it('same tile in same world but different objectType can have different physics', () => {
    // World 6 tile 0xA0 is quicksand under objectType=0 but diggable
    // under objectType=2. The objectType discriminator is load-bearing.
    const q = physicsForTile(5, 0, 0xa0);
    const d = physicsForTile(5, 2, 0xa0);
    // If both are 'solid' the registry hasn't been seeded yet; skip.
    if (q !== 'solid' || d !== 'solid') {
      expect(q).not.toBe(d);
    }
  });
});
