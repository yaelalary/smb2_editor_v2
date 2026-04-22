import { describe, it, expect } from 'vitest';
import {
  SetItemDestinationCommand,
  PairItemsCommand,
  CreatePairedDoorCommand,
  SetPointerDestinationCommand,
  itemDestination,
  itemDestinationSlot,
  tilePageOf,
  findBackPointer,
  isOrphan,
  buildOrphanIndex,
  isRoutingItem,
  computeSpawnPosition,
  pointerDestination,
} from '@/commands/routing-commands';
import type { LevelBlock, LevelItem, LevelMap } from '@/rom/model';

/**
 * Synthetic fixtures — no ROM needed.
 *
 * SMB2 entrance destination encoding:
 *   slot = tens * 10 + ones
 *   4-byte: [pos, id, tens, (ones<<4)|page]
 *   5-byte: [pos, id, 0xF5, tens, (ones<<4)|page]
 *     (far pointer — used when slot > 150)
 *   2-byte: [pos, id] → no destination
 */

function makeBlock(items: LevelItem[], direction = 1): LevelBlock {
  return {
    header: {
      direction, palette: 0, enemyColor: 0, groundSet: 0, length: 3,
      objectType: 0, groundType: 0, music: 0, reservedBits: 0,
      sourceBytes: new Uint8Array(4),
    },
    items,
    sourceRange: [0, 0],
    byteLength: items.reduce((n, it) => n + it.sourceBytes.byteLength, 0),
    isEdited: false,
    referencingSlots: [],
  } as LevelBlock;
}

function makeEntrance(...bytes: number[]): LevelItem {
  return {
    kind: 'entrance',
    sourceBytes: new Uint8Array(bytes),
    sourceRange: [0, 0],
    tileX: 0,
    tileY: 0,
    itemId: bytes[1] ?? 0,
  } as LevelItem;
}

function makeEntranceAt(bytes: number[], tileX: number, tileY: number): LevelItem {
  return {
    kind: 'entrance',
    sourceBytes: new Uint8Array(bytes),
    sourceRange: [0, 0],
    tileX,
    tileY,
    itemId: bytes[1] ?? 0,
  } as LevelItem;
}

function makePointer(slot: number, page: number, tileX = 0, tileY = 0): LevelItem {
  const s = Math.max(0, Math.min(209, Math.floor(slot)));
  const p = Math.max(0, Math.min(9, Math.floor(page))) & 0x0f;
  const tens = Math.floor(s / 10);
  const ones = s % 10;
  return {
    kind: 'pointer',
    sourceBytes: new Uint8Array([0xf5, tens, (ones << 4) | p]),
    sourceRange: [0, 0],
    tileX,
    tileY,
    itemId: -1,
  } as LevelItem;
}

/**
 * Build a minimal LevelMap with a handful of rooms, each mapped 1:1 to
 * its slot (no sharing). Slots not listed are absent (slotToBlock[x] = -1).
 */
function makeMap(rooms: Array<{ slot: number; block: LevelBlock }>): LevelMap {
  const blocks = rooms.map((r) => r.block);
  const slotToBlock: number[] = Array.from({ length: 210 }, () => -1);
  rooms.forEach((r, i) => { slotToBlock[r.slot] = i; });
  return { blocks, slotToBlock } as unknown as LevelMap;
}

describe('itemDestination', () => {
  it('returns null for 2-byte entrance', () => {
    expect(itemDestination(makeEntrance(0x00, 0x0a))).toBe(null);
  });

  it('decodes slot 42 from 4-byte entrance (tens=4, ones=2, page=0)', () => {
    // slot 42 → byte2=4, byte3=(2<<4)|0 = 0x20
    const item = makeEntrance(0x00, 0x0a, 4, 0x20);
    expect(itemDestination(item)).toEqual({ slot: 42, page: 0, farPointer: false });
  });

  it('preserves page nibble in decoded destination', () => {
    // slot 12, page 5 → byte2=1, byte3=(2<<4)|5 = 0x25
    const item = makeEntrance(0x00, 0x0a, 1, 0x25);
    expect(itemDestination(item)).toEqual({ slot: 12, page: 5, farPointer: false });
  });

  it('decodes slot 200 from 5-byte far pointer', () => {
    // slot 200 → byte3=20, byte4=(0<<4)|0 = 0x00
    const item = makeEntrance(0x00, 0x0a, 0xf5, 20, 0x00);
    expect(itemDestination(item)).toEqual({ slot: 200, page: 0, farPointer: true });
  });

  it('returns null for invalid decoded slot (>= 210)', () => {
    // byte2=21, byte3=(0<<4)|0 → slot 210 (out of range)
    const item = makeEntrance(0x00, 0x0a, 21, 0x00);
    expect(itemDestination(item)).toBe(null);
  });

  it('itemDestinationSlot is a back-compat shortcut', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20);
    expect(itemDestinationSlot(item)).toBe(42);
  });
});

describe('SetItemDestinationCommand', () => {
  it('promotes 2-byte entrance to 4-byte with correct encoding (slot 42)', () => {
    const item = makeEntrance(0x00, 0x0a);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 42).execute();
    // tens=4, ones=2, page=0 → byte3 = 0x20
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 4, 0x20]));
    expect(block.byteLength).toBe(4);
    expect(block.isEdited).toBe(true);
  });

  it('uses 5-byte far pointer for slot > 150', () => {
    const item = makeEntrance(0x00, 0x0a);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 200).execute();
    // slot 200 → tens=20, ones=0 → bytes [0xF5, 20, 0x00]
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 0xf5, 20, 0x00]));
    expect(block.byteLength).toBe(5);
  });

  it('preserves existing page when changing destination slot', () => {
    // Existing: slot 12, page 5 → [0, id, 1, 0x25]
    const item = makeEntrance(0x00, 0x0a, 1, 0x25);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 30).execute();
    // slot 30 → tens=3, ones=0 → byte3 = (0<<4)|5 = 0x05 (page preserved)
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 3, 0x05]));
    expect(itemDestination(item)).toEqual({ slot: 30, page: 5, farPointer: false });
  });

  it('shrinks to 2-byte when destination cleared (null)', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, null).execute();
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a]));
    expect(block.byteLength).toBe(2);
    expect(block.isEdited).toBe(true);
  });

  it('switches from 4-byte to 5-byte when crossing threshold', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20); // was slot 42
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 180).execute();
    // slot 180 → tens=18, ones=0 → far pointer
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 0xf5, 18, 0x00]));
    expect(block.byteLength).toBe(5);
  });

  it('switches from 5-byte to 4-byte when descending below threshold', () => {
    const item = makeEntrance(0x00, 0x0a, 0xf5, 20, 0x00); // was slot 200
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 50).execute();
    // slot 50 → tens=5, ones=0 → 4-byte
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 5, 0x00]));
    expect(block.byteLength).toBe(4);
  });

  it('clamps destination slot to 0..209', () => {
    const item = makeEntrance(0x00, 0x0a);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 500).execute();
    // slot 209 → tens=20, ones=9 → byte3 = 0x90, 5-byte
    expect(itemDestinationSlot(item)).toBe(209);
    new SetItemDestinationCommand(block, item, -1).execute();
    // slot 0 → 4-byte
    expect(itemDestinationSlot(item)).toBe(0);
  });

  it('undo restores original bytes and byteLength', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20); // slot 42
    const block = makeBlock([item]);
    const cmd = new SetItemDestinationCommand(block, item, null);
    cmd.execute();
    expect(item.sourceBytes.byteLength).toBe(2);
    cmd.undo();
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 4, 0x20]));
    expect(block.byteLength).toBe(4);
  });
});

describe('isRoutingItem', () => {
  it('true for entrance kind', () => {
    expect(isRoutingItem(makeEntrance(0x00, 0x0a))).toBe(true);
  });

  it('true for enterable jars (0x06, 0x07, 0x08)', () => {
    const jar: LevelItem = { ...makeEntrance(0x00, 0x08), kind: 'regular' } as LevelItem;
    expect(isRoutingItem(jar)).toBe(true);
  });

  it('false for static jar 0x04', () => {
    const staticJar: LevelItem = { ...makeEntrance(0x00, 0x04), kind: 'regular' } as LevelItem;
    expect(isRoutingItem(staticJar)).toBe(false);
  });
});

describe('tilePageOf', () => {
  it('horizontal room: page = floor(tileX / 16)', () => {
    const hBlock = makeBlock([], 1);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 0, 5), hBlock)).toBe(0);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 15, 5), hBlock)).toBe(0);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 16, 5), hBlock)).toBe(1);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 47, 5), hBlock)).toBe(2);
  });

  it('vertical room: page = floor(tileY / 15)', () => {
    const vBlock = makeBlock([], 0);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 5, 0), vBlock)).toBe(0);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 5, 14), vBlock)).toBe(0);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 5, 15), vBlock)).toBe(1);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 5, 44), vBlock)).toBe(2);
  });

  it('clamps to 0..9 for out-of-range coords', () => {
    const hBlock = makeBlock([], 1);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], 999, 0), hBlock)).toBe(9);
    expect(tilePageOf(makeEntranceAt([0, 0x0a], -5, 0), hBlock)).toBe(0);
  });
});

describe('findBackPointer (strict pair)', () => {
  it('finds the strict partner when both slot AND page match', () => {
    // A at (0,0) in slot 3 → dest (7, page 0)
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0);
    // B at (0,0) in slot 7 → dest (3, page 0)
    const b = makeEntranceAt([0x00, 0x0a, 0, 0x30], 0, 0);
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([b]) },
    ]);
    // A's pair: in slot 7, at dest.page 0, pointing back to (3, 0)
    expect(findBackPointer(map, 3, 0, 7, 0)).toBe(b);
    expect(findBackPointer(map, 7, 0, 3, 0)).toBe(a);
  });

  it('returns null when no door sits at destPage', () => {
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0); // slot 3 → (7, page 0)
    // B in slot 7 at tileX=20 (page 1), points back to (3, 0)
    const b = makeEntranceAt([0x00, 0x0a, 0, 0x30], 20, 0);
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([b]) },
    ]);
    // Expected page 0 in slot 7 — B is at page 1. No strict match.
    expect(findBackPointer(map, 3, 0, 7, 0)).toBe(null);
  });

  it('returns null when back-pointer slot mismatches', () => {
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0); // slot 3 → (7, 0)
    // B at (0,0) in slot 7, but B points to slot 5 (not 3)
    const b = makeEntranceAt([0x00, 0x0a, 0, 0x50], 0, 0);
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([b]) },
    ]);
    expect(findBackPointer(map, 3, 0, 7, 0)).toBe(null);
  });

  it('returns null when back-pointer page mismatches', () => {
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0); // slot 3 → (7, 0), A at page 0
    // B at (0,0) in slot 7 (page 0), pointing back to (3, page 2) — wrong page
    const b = makeEntranceAt([0x00, 0x0a, 0, 0x32], 0, 0);
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([b]) },
    ]);
    expect(findBackPointer(map, 3, 0, 7, 0)).toBe(null);
  });

  it('returns null when destRoom slot is not mapped', () => {
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0);
    const map = makeMap([{ slot: 3, block: makeBlock([a]) }]);
    expect(findBackPointer(map, 3, 0, 7, 0)).toBe(null);
  });

  it('distinguishes legit pair from orphan leftover in same room', () => {
    // Z (old pair, at page 0) + B (new pair, at page 1) both in slot 7, both point back to slot 3.
    // A (in slot 3) is paired with B (not Z): its dest.page = 1.
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x71], 0, 0); // slot 3 → (7, page 1)
    const zOld = makeEntranceAt([0x00, 0x0a, 0, 0x30], 0, 0); // slot 7 at page 0 → (3, 0) — orphan
    const bNew = makeEntranceAt([0x00, 0x0a, 0, 0x30], 20, 0); // slot 7 at page 1 → (3, 0)
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([zOld, bNew]) },
    ]);
    // A's sourcePage = 0 (it's at tileX=0). A's destPage = 1.
    // Strict check: find item in slot 7 at page 1 pointing back to (3, 0). That's bNew.
    expect(findBackPointer(map, 3, 0, 7, 1)).toBe(bNew);
  });
});

describe('isOrphan / buildOrphanIndex', () => {
  it('unpaired door (no dest) is NOT orphan', () => {
    const unpaired = makeEntrance(0x00, 0x0a); // 2-byte
    const block = makeBlock([unpaired]);
    const map = makeMap([{ slot: 3, block }]);
    expect(isOrphan(unpaired, block, 3, map)).toBe(false);
    expect(buildOrphanIndex(map).count).toBe(0);
  });

  it('paired round-trip doors are NOT orphan', () => {
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0); // slot 3 → (7, 0), page 0
    const b = makeEntranceAt([0x00, 0x0a, 0, 0x30], 0, 0); // slot 7 → (3, 0), page 0
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([b]) },
    ]);
    const idx = buildOrphanIndex(map);
    expect(idx.count).toBe(0);
    expect(idx.orphans.has(a)).toBe(false);
    expect(idx.orphans.has(b)).toBe(false);
  });

  it('one-way door is orphan', () => {
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0);
    const aBlock = makeBlock([a]);
    const map = makeMap([
      { slot: 3, block: aBlock },
      { slot: 7, block: makeBlock([]) },
    ]);
    expect(isOrphan(a, aBlock, 3, map)).toBe(true);
    const idx = buildOrphanIndex(map);
    expect(idx.count).toBe(1);
    expect(idx.orphans.has(a)).toBe(true);
  });

  it('same slot back-pointer at wrong page is orphan (strict check)', () => {
    // A at (0,0) in slot 3 → dest (7, page 0).
    // B at (20, 0) in slot 7 (page 1) → dest (3, 0).
    // Slot-level "back-pointer" exists (B points to slot 3), but B sits at
    // page 1 while A expects partner at page 0 → not a strict pair.
    const a = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0);
    const b = makeEntranceAt([0x00, 0x0a, 0, 0x30], 20, 0);
    const map = makeMap([
      { slot: 3, block: makeBlock([a]) },
      { slot: 7, block: makeBlock([b]) },
    ]);
    const idx = buildOrphanIndex(map);
    expect(idx.orphans.has(a)).toBe(true);
    expect(idx.orphans.has(b)).toBe(true);
  });

  it('re-pair orphans the previous partners on BOTH sides', () => {
    // Setup: two pairs, A1↔B1 and A2↔B2, all in separate rooms at (0,0).
    const a1 = makeEntranceAt([0x00, 0x0a, 0, 0x50], 0, 0); // slot 0 → (5, 0)
    const b1 = makeEntranceAt([0x00, 0x0a, 0, 0x00], 0, 0); // slot 5 → (0, 0)
    const a2 = makeEntranceAt([0x00, 0x0a, 0, 0x90], 0, 0); // slot 7 → (9, 0)
    const b2 = makeEntranceAt([0x00, 0x0a, 0, 0x70], 0, 0); // slot 9 → (7, 0)
    const map = makeMap([
      { slot: 0, block: makeBlock([a1]) },
      { slot: 5, block: makeBlock([b1]) },
      { slot: 7, block: makeBlock([a2]) },
      { slot: 9, block: makeBlock([b2]) },
    ]);
    // Initial state: zero orphans.
    expect(buildOrphanIndex(map).count).toBe(0);

    // Simulate user pairing A1 ↔ A2 (both at page 0 in their rooms):
    a1.sourceBytes = new Uint8Array([0x00, 0x0a, 0, 0x70]); // 0 → (7, 0)
    a2.sourceBytes = new Uint8Array([0x00, 0x0a, 0, 0x00]); // 7 → (0, 0)
    // B1 and B2 untouched.

    const idx = buildOrphanIndex(map);
    // A1 and A2 are now paired: not orphan.
    expect(idx.orphans.has(a1)).toBe(false);
    expect(idx.orphans.has(a2)).toBe(false);
    // B1 still points at slot 0, but A1 no longer points back to 5 → orphan.
    expect(idx.orphans.has(b1)).toBe(true);
    // B2 still points at slot 7, but A2 no longer points back to 9 → orphan.
    expect(idx.orphans.has(b2)).toBe(true);
    expect(idx.count).toBe(2);
  });
});

describe('PairItemsCommand', () => {
  it('pairs two unpaired doors bidirectionally with correct pages', () => {
    // A at (20, 0) in horizontal slot 3 → page 1
    // B at (0, 30) in vertical slot 7 → page 2 (30/15)
    const itemA = makeEntranceAt([0x00, 0x0a], 20, 0);
    const itemB = makeEntranceAt([0x00, 0x0a], 0, 30);
    const blockA = makeBlock([itemA], 1); // horizontal
    const blockB = makeBlock([itemB], 0); // vertical
    new PairItemsCommand(blockA, itemA, 3, blockB, itemB, 7).execute();
    expect(itemDestination(itemA)).toEqual({ slot: 7, page: 2, farPointer: false });
    expect(itemDestination(itemB)).toEqual({ slot: 3, page: 1, farPointer: false });
    expect(blockA.isEdited).toBe(true);
    expect(blockB.isEdited).toBe(true);
  });

  it('leaves both items at their original positions', () => {
    const itemA = makeEntranceAt([0x00, 0x0a], 20, 0);
    const itemB = makeEntranceAt([0x00, 0x0a], 0, 30);
    const blockA = makeBlock([itemA], 1);
    const blockB = makeBlock([itemB], 0);
    new PairItemsCommand(blockA, itemA, 3, blockB, itemB, 7).execute();
    expect(itemA.tileX).toBe(20);
    expect(itemA.tileY).toBe(0);
    expect(itemB.tileX).toBe(0);
    expect(itemB.tileY).toBe(30);
  });

  it('promotes both items from 2-byte to 4-byte form', () => {
    const itemA = makeEntrance(0x00, 0x0a);
    const itemB = makeEntrance(0x00, 0x0a);
    const blockA = makeBlock([itemA]);
    const blockB = makeBlock([itemB]);
    const byteBeforeA = blockA.byteLength;
    const byteBeforeB = blockB.byteLength;
    new PairItemsCommand(blockA, itemA, 3, blockB, itemB, 7).execute();
    expect(itemA.sourceBytes.byteLength).toBe(4);
    expect(itemB.sourceBytes.byteLength).toBe(4);
    expect(blockA.byteLength).toBe(byteBeforeA + 2);
    expect(blockB.byteLength).toBe(byteBeforeB + 2);
  });

  it('uses 5-byte far-pointer form when targeting slot > 150', () => {
    const itemA = makeEntrance(0x00, 0x0a);
    const itemB = makeEntrance(0x00, 0x0a);
    const blockA = makeBlock([itemA]);
    const blockB = makeBlock([itemB]);
    new PairItemsCommand(blockA, itemA, 3, blockB, itemB, 200).execute();
    expect(itemA.sourceBytes.byteLength).toBe(5);
    expect(itemA.sourceBytes[2]).toBe(0xf5);
    expect(itemDestination(itemA)?.slot).toBe(200);
    expect(itemB.sourceBytes.byteLength).toBe(4);
    expect(itemDestination(itemB)?.slot).toBe(3);
  });

  it('undo restores both sides of the pair (bytes only)', () => {
    const itemA = makeEntranceAt([0x00, 0x0a], 20, 0);
    const itemB = makeEntranceAt([0x00, 0x0a], 0, 30);
    const blockA = makeBlock([itemA], 1);
    const blockB = makeBlock([itemB], 0);
    const originalA = new Uint8Array(itemA.sourceBytes);
    const originalB = new Uint8Array(itemB.sourceBytes);
    const lenABefore = blockA.byteLength;
    const lenBBefore = blockB.byteLength;
    const cmd = new PairItemsCommand(blockA, itemA, 3, blockB, itemB, 7);
    cmd.execute();
    cmd.undo();
    expect(itemA.sourceBytes).toEqual(originalA);
    expect(itemB.sourceBytes).toEqual(originalB);
    expect(blockA.byteLength).toBe(lenABefore);
    expect(blockB.byteLength).toBe(lenBBefore);
  });

  it('same-block pairing: byteLength deltas stack correctly', () => {
    const itemA = makeEntranceAt([0x00, 0x0a], 10, 0);
    const itemB = makeEntranceAt([0x00, 0x0a], 40, 0);
    const block = makeBlock([itemA, itemB], 1);
    const lenBefore = block.byteLength;
    new PairItemsCommand(block, itemA, 5, block, itemB, 5).execute();
    expect(block.byteLength).toBe(lenBefore + 4);
    expect(itemDestination(itemA)).toEqual({ slot: 5, page: 2, farPointer: false });
    expect(itemDestination(itemB)).toEqual({ slot: 5, page: 0, farPointer: false });
    // Positions untouched.
    expect(itemA.tileX).toBe(10);
    expect(itemB.tileX).toBe(40);
  });
});

describe('CreatePairedDoorCommand', () => {
  it('places new door at the SMB2 spawn tile with reciprocal dest', () => {
    // A at (14, 56) vertical. Pairing into a horizontal dest at page 8.
    // Spawn formula: (8*16 + 15 - 14, 56%15) = (129, 11).
    const itemA = makeEntranceAt([0x00, 0x0a], 14, 56);
    const blockA = makeBlock([itemA], 0); // vertical
    const destBlock = makeBlock([], 1); // horizontal, empty
    new CreatePairedDoorCommand(
      blockA, itemA, /*slotA*/ 0,
      destBlock, /*destSlot*/ 2, /*destPage*/ 8, /*doorId*/ 0x0a,
    ).execute();

    // A now points to (2, 8).
    expect(itemDestination(itemA)).toEqual({ slot: 2, page: 8, farPointer: false });

    // A new door appeared in destBlock at the spawn tile.
    expect(destBlock.items.length).toBe(1);
    const created = destBlock.items[0]!;
    expect(created.kind).toBe('entrance');
    expect(created.itemId).toBe(0x0a);
    expect(created.tileX).toBe(129);
    expect(created.tileY).toBe(11);

    // The new door points back at A's slot + A's page.
    // A's page (vertical, Y=56) = 56/15 = 3.
    expect(itemDestination(created)).toEqual({ slot: 0, page: 3, farPointer: false });

    expect(blockA.isEdited).toBe(true);
    expect(destBlock.isEdited).toBe(true);
  });

  it('undo removes the created door and restores A bytes', () => {
    const itemA = makeEntranceAt([0x00, 0x0a], 14, 56);
    const blockA = makeBlock([itemA], 0);
    const destBlock = makeBlock([], 1);
    const originalA = new Uint8Array(itemA.sourceBytes);
    const lenABefore = blockA.byteLength;
    const lenBBefore = destBlock.byteLength;
    const cmd = new CreatePairedDoorCommand(
      blockA, itemA, 0, destBlock, 2, 8, 0x0a,
    );
    cmd.execute();
    expect(destBlock.items.length).toBe(1);
    cmd.undo();
    expect(destBlock.items.length).toBe(0);
    expect(itemA.sourceBytes).toEqual(originalA);
    expect(blockA.byteLength).toBe(lenABefore);
    expect(destBlock.byteLength).toBe(lenBBefore);
  });

  it('uses 5-byte far pointer when destSlot > 150', () => {
    const itemA = makeEntranceAt([0x00, 0x0a], 5, 3);
    const blockA = makeBlock([itemA], 1);
    const destBlock = makeBlock([], 1);
    new CreatePairedDoorCommand(
      blockA, itemA, 0, destBlock, 200, 0, 0x0a,
    ).execute();
    expect(itemA.sourceBytes.byteLength).toBe(5);
    expect(itemA.sourceBytes[2]).toBe(0xf5);
    expect(itemDestination(itemA)?.slot).toBe(200);
  });
});

describe('computeSpawnPosition', () => {
  it('horizontal destination: (destPage*16 + 15-sx%16, sy%15)', () => {
    const src = makeEntranceAt([0x00, 0x0a], 20, 0); // sx%16 = 4, sy%15 = 0
    const destH = makeBlock([], 1);
    expect(computeSpawnPosition(src, destH, 2)).toEqual({ tileX: 2 * 16 + 11, tileY: 0 });
  });

  it('vertical destination: (15-sx%16, destPage*15 + sy%15)', () => {
    const src = makeEntranceAt([0x00, 0x0a], 5, 3); // sx%16 = 5, sy%15 = 3
    const destV = makeBlock([], 0);
    expect(computeSpawnPosition(src, destV, 1)).toEqual({ tileX: 10, tileY: 18 });
  });
});

describe('pointerDestination', () => {
  it('decodes a plain pointer (slot ≤ 150)', () => {
    // slot 42 → tens=4, ones=2. page=7. Bytes: [0xF5, 4, (2<<4)|7 = 0x27].
    const ptr = makePointer(42, 7);
    expect(pointerDestination(ptr)).toEqual({ slot: 42, page: 7, farPointer: false });
  });

  it('decodes a high-slot pointer (no 5-byte far form for pointers)', () => {
    const ptr = makePointer(200, 3);
    expect(pointerDestination(ptr)).toEqual({ slot: 200, page: 3, farPointer: false });
  });

  it('returns null for non-pointer items', () => {
    const it = makeEntrance(0x00, 0x0a, 4, 0x20);
    expect(pointerDestination(it)).toBe(null);
  });

  it('returns null if first byte is not 0xF5', () => {
    const malformed = {
      ...makePointer(10, 0),
      sourceBytes: new Uint8Array([0x00, 1, 0x00]),
    } as LevelItem;
    expect(pointerDestination(malformed)).toBe(null);
  });
});

describe('SetPointerDestinationCommand', () => {
  it('updates slot and page, keeps byteLength constant', () => {
    const ptr = makePointer(10, 0);
    const block = makeBlock([ptr]);
    const lenBefore = block.byteLength;
    new SetPointerDestinationCommand(block, ptr, 42, 7).execute();
    expect(pointerDestination(ptr)).toEqual({ slot: 42, page: 7, farPointer: false });
    expect(block.byteLength).toBe(lenBefore); // pointer is always 3 bytes
    expect(block.isEdited).toBe(true);
  });

  it('clamps slot to 0..209 and page to 0..9', () => {
    const ptr = makePointer(10, 0);
    const block = makeBlock([ptr]);
    new SetPointerDestinationCommand(block, ptr, 500, 99).execute();
    expect(pointerDestination(ptr)).toEqual({ slot: 209, page: 9, farPointer: false });
    new SetPointerDestinationCommand(block, ptr, -5, -1).execute();
    expect(pointerDestination(ptr)).toEqual({ slot: 0, page: 0, farPointer: false });
  });

  it('undo restores original bytes', () => {
    const ptr = makePointer(10, 0);
    const block = makeBlock([ptr]);
    const original = new Uint8Array(ptr.sourceBytes);
    const cmd = new SetPointerDestinationCommand(block, ptr, 42, 7);
    cmd.execute();
    expect(pointerDestination(ptr)).toEqual({ slot: 42, page: 7, farPointer: false });
    cmd.undo();
    expect(ptr.sourceBytes).toEqual(original);
    expect(pointerDestination(ptr)).toEqual({ slot: 10, page: 0, farPointer: false });
  });
});
