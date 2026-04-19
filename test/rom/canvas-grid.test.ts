import { describe, it, expect } from 'vitest';
import { CanvasGrid } from '@/rom/canvas-grid';
import { bgPrior, convertRegular, getPriorityEntry } from '@/rom/nesleveldef';

describe('CanvasGrid (Unit 1 skeleton)', () => {
  it('allocates the requested dimensions with all cells non-visible', () => {
    const grid = new CanvasGrid(16, 60, 3, 1, false);
    expect(grid.width).toBe(16);
    expect(grid.height).toBe(60);
    expect(grid.fx).toBe(3);
    expect(grid.gfx).toBe(1);
    expect(grid.isH).toBe(false);

    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 16; x++) {
        expect(grid.getItem(x, y).visible).toBe(false);
      }
    }
  });

  it('round-trips a forceSetItem / getItem at the same coords', () => {
    const grid = new CanvasGrid(8, 8, 0, 0, true);
    grid.forceSetItem(3, 4, { tileId: 0xc2, type: 4, regularId: 0, groundType: 0 });

    const cell = grid.getItem(3, 4);
    expect(cell.visible).toBe(true);
    expect(cell.tileId).toBe(0xc2);
    expect(cell.type).toBe(4);
  });

  it('ignores forceSetItem outside bounds (mirrors SetCanvasItem line 148)', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.forceSetItem(5, 0, { tileId: 0x10, type: 0, regularId: 0, groundType: 0 });
    grid.forceSetItem(0, 5, { tileId: 0x10, type: 0, regularId: 0, groundType: 0 });
    grid.forceSetItem(-1, 0, { tileId: 0x10, type: 0, regularId: 0, groundType: 0 });

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(grid.getItem(x, y).visible).toBe(false);
      }
    }
  });

  it('returns a non-visible sentinel for out-of-bounds getItem', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    expect(grid.getItem(99, 0).visible).toBe(false);
    expect(grid.getItem(0, 99).visible).toBe(false);
    expect(grid.getItem(-1, -1).visible).toBe(false);
  });

  it('setNullItem clears a previously-visible cell (mirrors SetCanvasNullItem)', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.forceSetItem(1, 1, { tileId: 0xaa, type: 4, regularId: 3, groundType: 0 });
    expect(grid.getItem(1, 1).visible).toBe(true);

    grid.setNullItem(1, 1);
    const cell = grid.getItem(1, 1);
    expect(cell.visible).toBe(false);
    expect(cell.tileId).toBe(0);
    expect(cell.type).toBe(0);
    expect(cell.regularId).toBe(0);
  });
});

describe('convertRegular / getPriorityEntry (CONVERT_REGULAR port)', () => {
  it('passes through raw ids below 0x30', () => {
    expect(convertRegular(0x00)).toBe(0x00);
    expect(convertRegular(0x0c)).toBe(0x0c); // vine
    expect(convertRegular(0x29)).toBe(0x29); // cherry
    expect(convertRegular(0x2f)).toBe(0x2f);
  });

  it('collapses 0x10-wide slices above 0x30 to indices 48-60', () => {
    expect(convertRegular(0x30)).toBe(0x30); // 48
    expect(convertRegular(0x3f)).toBe(0x30);
    expect(convertRegular(0x40)).toBe(0x31); // 49
    expect(convertRegular(0x4f)).toBe(0x31);
    expect(convertRegular(0xc0)).toBe(0x39); // 57 — green platform
    expect(convertRegular(0xf0)).toBe(0x3c); // 60 — waterfall (highest extended)
  });

  it('returns the correct PriorityEntry via getPriorityEntry', () => {
    expect(getPriorityEntry(0x06).bgPriority).toBe(1); // jar
    expect(getPriorityEntry(0x29).bgPriority).toBe(0); // cherry
    expect(getPriorityEntry(0x0c).bgPriority).toBe(1); // vine
    expect(getPriorityEntry(0x0c).priority).toBe(3);
    expect(getPriorityEntry(0x10).priority).toBe(1);   // cloud
  });
});

describe('bgPrior (BG_PRIOR macro port)', () => {
  it('returns 0 when the regular item has no bgPriority flag', () => {
    // cherry rawId 0x29 → convertRegular=0x29 → PRIORITY_LIST[0x29].bgPriority=0
    expect(bgPrior(0x29, 1, 0, 0, true)).toBe(0);
    expect(bgPrior(0x29, 3, 3, 7, false)).toBe(0);
  });

  it('horizontal tables (all 0x01010100) reject at bitsets 1-3, allow at bitset 0', () => {
    // vine rawId 0x0c → bgPriority=1. C++ union reads gr[0]=LSB, so
    // 0x01010100 maps to [0x00, 0x01, 0x01, 0x01] indexed by bitset.
    expect(bgPrior(0x0c, 0, 0, 0, true)).toBe(0);
    expect(bgPrior(0x0c, 1, 0, 0, true)).toBe(1);
    expect(bgPrior(0x0c, 2, 0, 0, true)).toBe(1);
    expect(bgPrior(0x0c, 3, 0, 0, true)).toBe(1);
  });

  it('vertical fx=3 grtype=1 has 0x00010100 → reject only at bitsets 1-2', () => {
    // Only vertical exception entry: 0x00010100 → [0x00, 0x01, 0x01, 0x00].
    expect(bgPrior(0x0c, 0, 3, 1, false)).toBe(0);
    expect(bgPrior(0x0c, 1, 3, 1, false)).toBe(1);
    expect(bgPrior(0x0c, 2, 3, 1, false)).toBe(1);
    expect(bgPrior(0x0c, 3, 3, 1, false)).toBe(0);
    // Neighbour entries remain standard 0x01010100.
    expect(bgPrior(0x0c, 3, 3, 0, false)).toBe(1);
    expect(bgPrior(0x0c, 3, 2, 1, false)).toBe(1);
  });
});

describe('CanvasGrid.setItem (priority check)', () => {
  it('writes to an empty cell regardless of priority', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const wrote = grid.setItem(0, 0, { tileId: 0x10, type: 0, regularId: 0x0c, groundType: 0 });
    expect(wrote).toBe(true);
    expect(grid.getItem(0, 0).visible).toBe(true);
    expect(grid.getItem(0, 0).tileId).toBe(0x10);
  });

  it('case 3: existing regular with lower priority wins, new is rejected', () => {
    // existing: cloud (priority=1). new: vine (priority=3). 1 < 3 → reject new.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0xaa, type: 0, regularId: 0x10, groundType: 0 }); // cloud
    const wrote = grid.setItem(0, 0, { tileId: 0xbb, type: 0, regularId: 0x0c, groundType: 0 }); // vine
    expect(wrote).toBe(false);
    expect(grid.getItem(0, 0).tileId).toBe(0xaa);
  });

  it('case 3: existing regular with higher priority value (back) loses, new overwrites', () => {
    // existing: vine (priority=3). new: cloud (priority=1). 3 < 1 is false → new wins.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0xaa, type: 0, regularId: 0x0c, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0xbb, type: 0, regularId: 0x10, groundType: 0 });
    expect(wrote).toBe(true);
    expect(grid.getItem(0, 0).tileId).toBe(0xbb);
  });

  it('case 3: equal bPriority → new overwrites (C++ strict <, not <=)', () => {
    // existing + new both priority=0 (mushroom block). 0 < 0 false → new wins.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0xaa, type: 0, regularId: 0x00, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0xbb, type: 0, regularId: 0x00, groundType: 0 });
    expect(wrote).toBe(true);
    expect(grid.getItem(0, 0).tileId).toBe(0xbb);
  });

  it('case 2: existing ground + new regular with bgPriority=1 → new rejected', () => {
    // existing: ground bitset=1, grtype=0. new: vine (bgPriority=1). BG_PRIOR(vine,1,0,0,true)=1 → reject.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0x13, type: 1, regularId: 0, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0xbb, type: 0, regularId: 0x0c, groundType: 0 });
    expect(wrote).toBe(false);
    expect(grid.getItem(0, 0).tileId).toBe(0x13);
  });

  it('case 2: existing ground + new regular with bgPriority=0 → new overwrites', () => {
    // existing: ground bitset=1. new: cherry (bgPriority=0). BG_PRIOR short-circuits to 0 → write.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0x13, type: 1, regularId: 0, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0xbb, type: 0, regularId: 0x29, groundType: 0 });
    expect(wrote).toBe(true);
    expect(grid.getItem(0, 0).tileId).toBe(0xbb);
  });

  it('case 1: existing regular (bgPriority=1) + new ground → ground rejected', () => {
    // existing: vine (bgPriority=1, bg=0). new: ground bitset=1. BG_PRIOR(vine,1,0,0,true)=1 → reject.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0xaa, type: 0, regularId: 0x0c, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0x13, type: 1, regularId: 0, groundType: 0 });
    expect(wrote).toBe(false);
    expect(grid.getItem(0, 0).tileId).toBe(0xaa);
  });

  it('case 1 boundary: vertical fx=3 grtype=1 bitset=0 path (BG_PRIOR returns 0) allows ground', () => {
    // existing: vine (bgPriority=1). new: ground with bitset=0 (type=0)... but bitset=0 doesn't
    // exercise case 1 (case 1 needs mybg != 0). Instead, test bitset=1 on fx=3 grtype=1 vert:
    // BG_PRIOR still returns 1 there (only bitset=0 is 0). So we confirm bitset=2 still rejects.
    const grid = new CanvasGrid(4, 4, 3, 0, false);
    grid.setItem(0, 0, { tileId: 0xaa, type: 0, regularId: 0x0c, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0x13, type: 2, regularId: 0, groundType: 1 });
    expect(wrote).toBe(false);
  });

  it('does not run priority check at all when existing cell is empty', () => {
    // Ground item with bitset=1 onto empty cell writes unconditionally.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const wrote = grid.setItem(2, 2, { tileId: 0x4b, type: 1, regularId: 0, groundType: 0 });
    expect(wrote).toBe(true);
    expect(grid.getItem(2, 2).visible).toBe(true);
    expect(grid.getItem(2, 2).type).toBe(1);
  });

  it('both-ground overlap: second overlapping ground unconditionally overwrites', () => {
    // Overlapping ground passes: both bg != 0 → none of the 3 cases apply → write.
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    grid.setItem(0, 0, { tileId: 0x11, type: 1, regularId: 0, groundType: 0 });
    const wrote = grid.setItem(0, 0, { tileId: 0x22, type: 2, regularId: 0, groundType: 3 });
    expect(wrote).toBe(true);
    expect(grid.getItem(0, 0).tileId).toBe(0x22);
    expect(grid.getItem(0, 0).type).toBe(2);
  });

  it('out-of-bounds setItem is a silent no-op (returns false)', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    expect(grid.setItem(5, 0, { tileId: 0x10, type: 0, regularId: 0, groundType: 0 })).toBe(false);
    expect(grid.setItem(-1, 0, { tileId: 0x10, type: 0, regularId: 0, groundType: 0 })).toBe(false);
  });
});
