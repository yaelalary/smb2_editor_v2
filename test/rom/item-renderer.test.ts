import { describe, it, expect } from 'vitest';
import { CanvasGrid } from '@/rom/canvas-grid';
import { renderItem } from '@/rom/item-renderer';
import type { LevelItem, LevelHeader } from '@/rom/model';

/**
 * Synthetic ROM helper. Seeds only the fields the renderer touches:
 *   - 0xCCCE — small cloud tile (GetSingDim for itemId 0x11)
 *   - 0xCCC2 / 0xCCC7 — big cloud tiles (GetSingDim for 0x10)
 *   - 0xCD40 + (itemId & 0x0F) — single ROM-read items (0x20-0x2F)
 *   - 0xCCD2..0xCCF9 — jar top/middle/bottom (GetVertDim ids 0x06-0x08)
 *   - 0xCD07/0xCD14 — vine top + middle (GetVertDim 0x0C)
 *   - 0xD0D5 / 0xD0DC — per-world pillar (GetVertDim 0x0F) for world=0
 *   - 0xCB81..0xCB85 — bridge tiles (GetHorzDim 0x0A) for non-castle
 *   - 0xCB8B — castle-world check (we use world != byte so the non-castle branch wires)
 *   - getObjTile pointers for HorzGr/VertGr testing (vid 0-7)
 */
function makeSyntheticRom(): Uint8Array {
  const rom = new Uint8Array(0x20000);

  // GetSingDim: small cloud (0x11) → 0xCCCE
  rom[0xccce] = 0xaa;
  // Big cloud (0x10) → 0xCCC2 + 0xCCC7
  rom[0xccc2] = 0xa0;
  rom[0xccc7] = 0xa1;
  // 0x20-0x2F → 0xCD40+n
  rom[0xcd40 + 9] = 0xc9; // cherry (0x29)

  // GetVertDim: jar 0x06 top 0xCCD2, middle 0xCCED, bottom 0xCCF9
  rom[0xccd2] = 0x10; // top
  rom[0xcced] = 0x20; // middle
  rom[0xccf9] = 0x30; // bottom

  // Vine 0x0C top 0xCD07, middle 0xCD14
  rom[0xcd07] = 0x40;
  rom[0xcd14] = 0x50;

  // Pillar 0x0F world=0 top/bottom 0xD0D5+0, middle 0xD0DC+0
  rom[0xd0d5] = 0x60;
  rom[0xd0dc] = 0x70;

  // Bridge 0x0A (non-castle world). getHorzDim reads from 0xCB81..0xCB85.
  rom[0xcb8b] = 7; // castle world = 7 (we test with world=0, so non-castle branch)
  rom[0xcb81] = 0x80; // topleft
  rom[0xcb83] = 0x81; // middle
  rom[0xcb85] = 0x82; // topright

  return rom;
}

function testHeader(): LevelHeader {
  return {
    palette: 0,
    groundSet: 0x1f,
    groundType: 0,
    enemyColor: 0,
    objectType: 1,
    direction: 1, // horizontal
    length: 3,
    pointerBlock: 0,
    pointerOffset: 0,
    rawBytes: new Uint8Array(4),
  } as LevelHeader;
}

function regularItem(itemId: number, tileX: number, tileY: number): LevelItem {
  return {
    kind: 'regular',
    itemId,
    tileX,
    tileY,
    sourceBytes: new Uint8Array([0, 0, 0]),
  } as LevelItem;
}

// ─── Single-tile items ─────────────────────────────────────────────

describe('renderItem — single-tile items (GetSingDim)', () => {
  it('cherry (rawId 0x29) writes one cell with type=4 (BG atlas) and ROM tileId', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(0x29, 4, 5), rom, 0, testHeader());
    const cell = grid.getItem(4, 5);
    expect(cell.visible).toBe(true);
    expect(cell.type).toBe(4);
    expect(cell.tileId).toBe(0xc9);
  });

  it('big cloud (rawId 0x10) writes two BG-atlas cells', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(0x10, 4, 5), rom, 0, testHeader());
    expect(grid.getItem(4, 5).tileId).toBe(0xa0);
    expect(grid.getItem(4, 5).type).toBe(4);
    expect(grid.getItem(5, 5).tileId).toBe(0xa1);
    expect(grid.getItem(5, 5).type).toBe(4);
  });

  it('POW block (rawId 0x01) falls back to ITEM_DIM when GetSingDim path unused for 0x01', () => {
    // GetSingDim handles 0..5 via castle-world branch; our stub sets 0xCB72 = 0, so
    // ptr = 0xCB50 + itemId. Read from 0xCB51 for POW.
    const rom = makeSyntheticRom();
    rom[0xcb72] = 7; // non-castle for world=0
    rom[0xcb51] = 0x15;
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(0x01, 2, 3), rom, 0, testHeader());
    expect(grid.getItem(2, 3).tileId).toBe(0x15);
    expect(grid.getItem(2, 3).type).toBe(4);
  });
});

// ─── Vertical extending items ──────────────────────────────────────

describe('renderItem — vertical items (GetVertDim)', () => {
  it('jar (rawId 0x06) at posY=10 writes top/middles/bottom using natural size formula', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    // Non-extended jar rawId=6; size = 0x0F * ceil((posY+0x0F)/0x0F) - posY - 1
    // posY=10 → size = 15 - 10 - 1 = 4. Writes cells (5,10)..(5,14).
    renderItem(grid, regularItem(0x06, 5, 10), rom, 0, testHeader());
    expect(grid.getItem(5, 10).tileId).toBe(0x10); // top
    expect(grid.getItem(5, 11).tileId).toBe(0x20); // middle
    expect(grid.getItem(5, 12).tileId).toBe(0x20);
    expect(grid.getItem(5, 13).tileId).toBe(0x20);
    expect(grid.getItem(5, 14).tileId).toBe(0x30); // bottom
  });

  it('vine (rawId 0x0C) stops at a pre-placed BG-atlas cell (canvas-grid live read)', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    // Pre-place a cloud at (5, 6): visible, type=4, tileId != 0x40.
    grid.forceSetItem(5, 6, { tileId: 0xaa, type: 4, regularId: 0x10, groundType: 0 });

    // Place a vine starting at (5, 4). Formula: size = 0x0f * ceil((y+15)/15) - y - 1
    // For y=4: size = 15 - 4 - 1 = 10. With isVine: size += 0x0f = 25. But it should
    // stop at y=6 (cloud cell), so we expect cells at (5,4) and (5,5) only.
    renderItem(grid, regularItem(0x0c, 5, 4), rom, 0, testHeader());

    // vine top at (5, 4)
    expect(grid.getItem(5, 4).visible).toBe(true);
    expect(grid.getItem(5, 4).tileId).toBe(0x40); // vine top
    // vine middle at (5, 5) — the cell before the blocker
    expect(grid.getItem(5, 5).tileId).toBe(0x50);
    // (5, 6) still shows the pre-placed cloud (vine setItem would be rejected anyway,
    // but more importantly the vine loop should have returned early).
    expect(grid.getItem(5, 6).tileId).toBe(0xaa);
    // (5, 7) was never touched.
    expect(grid.getItem(5, 7).visible).toBe(false);
  });

  it('vine (rawId 0x0C) with no blocker extends the full formula length', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(0x0c, 5, 4), rom, 0, testHeader());
    // For y=4, isVine: size = 10 + 15 = 25 cells beyond the top.
    // But grid is only 15 tall, so out-of-bounds writes are silent.
    // Inside grid: (5,4) top, (5,5)..(5,14) middle tiles.
    expect(grid.getItem(5, 4).tileId).toBe(0x40);
    expect(grid.getItem(5, 5).tileId).toBe(0x50);
    expect(grid.getItem(5, 14).tileId).toBe(0x50);
  });

  it('vine does NOT stop at a cell whose tileId === 0x40 (C++ exception)', () => {
    // "ng.idTile != 0x40" — a pre-existing vine-top cell must NOT halt
    // another vine, so chained vines still draw through.
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    grid.forceSetItem(5, 6, { tileId: 0x40, type: 4, regularId: 0x0c, groundType: 0 });
    renderItem(grid, regularItem(0x0c, 5, 4), rom, 0, testHeader());
    // Writes continue past (5, 6) — we should see vine middle past that row.
    expect(grid.getItem(5, 7).visible).toBe(true);
    expect(grid.getItem(5, 7).tileId).toBe(0x50);
  });
});

// ─── Horizontal items (bridge) ─────────────────────────────────────

describe('renderItem — horizontal items (GetHorzDim)', () => {
  it('bridge (vid=10 rawId 0xD3 size=3) writes topleft + middles + topright with type=4', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    // vid 10 → raw = 0x30 + 10*0x10 + size; for size=3: 0xD3.
    // But HorzDim uses internal id = raw-0x30 /0x10 mapped; vid=10 is special.
    // Actually HorzDim handles only ids 0x0A/0x0B (vid 10 = 0x0A).
    renderItem(grid, regularItem(0xd3, 4, 10), rom, 0, testHeader());
    expect(grid.getItem(4, 10).tileId).toBe(0x80);
    expect(grid.getItem(5, 10).tileId).toBe(0x81);
    expect(grid.getItem(6, 10).tileId).toBe(0x81);
    expect(grid.getItem(7, 10).tileId).toBe(0x82);
    expect(grid.getItem(4, 10).type).toBe(4);
  });
});

// ─── Sentinel items (pyramid, star bg) ─────────────────────────────

describe('renderItem — sentinel items', () => {
  it('horn / vegetable thrower (rawId 26) draws a fixed 2×2 from tiles 0x8C-0x8F', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(26, 5, 5), rom, 0, testHeader());
    expect(grid.getItem(5, 5).tileId).toBe(0x8c);
    expect(grid.getItem(6, 5).tileId).toBe(0x8d);
    expect(grid.getItem(5, 6).tileId).toBe(0x8e);
    expect(grid.getItem(6, 6).tileId).toBe(0x8f);
    expect(grid.getItem(5, 5).type).toBe(4);
    expect(grid.getItem(7, 5).visible).toBe(false);
  });

  it('pyramid (rawId 23) draws an expanding triangle with 4 distinct tiles', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(23, 5, 0), rom, 0, testHeader());
    // Row 0 (apex): LeftAngle, RightAngle at (5, 0) and (6, 0).
    expect(grid.getItem(5, 0).tileId).toBe(0x84);
    expect(grid.getItem(6, 0).tileId).toBe(0x87);
    // Row 1: LeftAngle, LeftInner, RightInner, RightAngle, starting one
    // column further left → cols 4..7.
    expect(grid.getItem(4, 1).tileId).toBe(0x84);
    expect(grid.getItem(5, 1).tileId).toBe(0x85);
    expect(grid.getItem(6, 1).tileId).toBe(0x86);
    expect(grid.getItem(7, 1).tileId).toBe(0x87);
    // Row 2: cols 3..8 with 2 inner tiles on each side.
    expect(grid.getItem(3, 2).tileId).toBe(0x84);
    expect(grid.getItem(4, 2).tileId).toBe(0x85);
    expect(grid.getItem(5, 2).tileId).toBe(0x85);
    expect(grid.getItem(6, 2).tileId).toBe(0x86);
    expect(grid.getItem(7, 2).tileId).toBe(0x86);
    expect(grid.getItem(8, 2).tileId).toBe(0x87);
    // BG-atlas (type=4) throughout.
    expect(grid.getItem(5, 0).type).toBe(4);
  });

  it('pyramid (rawId 23) stops when leftmost cell of next row is blocked', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    // Block the leftmost column of row 2 (which would be x=3 if starting at 5,0).
    grid.setItem(3, 2, { tileId: 0x99, type: 4, regularId: 0, groundType: 0 });
    renderItem(grid, regularItem(23, 5, 0), rom, 0, testHeader());
    // Rows 0 and 1 drawn.
    expect(grid.getItem(5, 0).tileId).toBe(0x84);
    expect(grid.getItem(4, 1).tileId).toBe(0x84);
    // Row 2 not drawn — pre-existing blocker preserved.
    expect(grid.getItem(3, 2).tileId).toBe(0x99);
    expect(grid.getItem(8, 2).visible).toBe(false);
  });

  it('pyramid (rawId 23) draws nothing when placement cell is blocked', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    grid.setItem(5, 0, { tileId: 0x99, type: 4, regularId: 0, groundType: 0 });
    renderItem(grid, regularItem(23, 5, 0), rom, 0, testHeader());
    expect(grid.getItem(5, 0).tileId).toBe(0x99);
    expect(grid.getItem(6, 0).visible).toBe(false);
    expect(grid.getItem(4, 1).visible).toBe(false);
  });

  it('star bg (rawId 14) scatters BG star tiles via the PRNG pattern', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(14, 0, 0), rom, 0, testHeader());
    // The PRNG seed is fixed (RAM_9=0x31, RAM_A=0x80) so the pattern is
    // deterministic. Sky cells aren't emitted; only Star1 (0x88) and
    // Star2 (0x89) are written with type=4 (BG atlas).
    let starCount = 0;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 16; x++) {
        const c = grid.getItem(x, y);
        if (!c.visible) continue;
        expect([0x88, 0x89]).toContain(c.tileId);
        expect(c.type).toBe(4);
        starCount++;
      }
    }
    // ~1/4 of cells become stars (2 of 8 PRNG buckets are non-sky).
    expect(starCount).toBeGreaterThan(0);
    expect(starCount).toBeLessThan(48); // 16 × 3 = 48 cells max
  });

  it('red bg (rawId 31) draws 12-tile-wide rows extending downward', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(31, 3, 3), rom, 0, testHeader());
    // Row pattern: Left, [MidLeft, MidRight] × 5, Right (BG-atlas, type=4).
    const expectedRow = [0x5c, 0x5d, 0x5f, 0x5d, 0x5f, 0x5d, 0x5f, 0x5d, 0x5f, 0x5d, 0x5f, 0x5e];
    for (let dx = 0; dx < 12; dx++) {
      const cell = grid.getItem(3 + dx, 3);
      expect(cell.tileId).toBe(expectedRow[dx]);
      expect(cell.type).toBe(4);
      expect(cell.visible).toBe(true);
    }
    // No blocking cells below → fills all the way to grid bottom.
    expect(grid.getItem(3, 14).tileId).toBe(0x5c);
    expect(grid.getItem(14, 14).tileId).toBe(0x5e);
  });

  it('red bg (rawId 31) stops at first blocked row below', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    // Plant a blocker (BG-atlas, non-sky) at the leftmost column on row 6.
    grid.setItem(3, 6, { tileId: 0x99, type: 4, regularId: 0, groundType: 0 });
    renderItem(grid, regularItem(31, 3, 3), rom, 0, testHeader());
    // Rows 3, 4, 5 should be drawn; row 6 was already blocked, so the
    // red-bg routine exits before overwriting it.
    expect(grid.getItem(3, 5).tileId).toBe(0x5c);
    expect(grid.getItem(3, 6).tileId).toBe(0x99);
    expect(grid.getItem(3, 7).visible).toBe(false);
  });

  it('red bg (rawId 31) draws nothing when placement cell is blocked', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    grid.setItem(3, 3, { tileId: 0x99, type: 4, regularId: 0, groundType: 0 });
    renderItem(grid, regularItem(31, 3, 3), rom, 0, testHeader());
    // The pre-existing tile is preserved; nothing else gets drawn.
    expect(grid.getItem(3, 3).tileId).toBe(0x99);
    expect(grid.getItem(4, 3).visible).toBe(false);
    expect(grid.getItem(3, 4).visible).toBe(false);
  });

  it('red bg (rawId 31) force-overwrites pre-existing items in its footprint', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    // Earlier-stream cloud at (8, 5): regularId=16, priority 1 (more in front).
    // Without force-overwrite, the priority check would reject the red bg here.
    grid.setItem(8, 5, { tileId: 0x42, type: 4, regularId: 16, groundType: 0 });
    renderItem(grid, regularItem(31, 3, 3), rom, 0, testHeader());
    // Column 8 falls inside [3..14] → row 5 of the red bg overwrites the cloud.
    // (Position 8 = posX+5, which is the MidLeft tile in the row pattern:
    //  Left at +0, then MidLeft/MidRight pairs at +1/+2, +3/+4, +5/+6, ...)
    expect(grid.getItem(8, 5).tileId).toBe(0x5d);
    expect(grid.getItem(8, 5).regularId).toBe(31);
  });
});

// ─── Out-of-bounds guard ───────────────────────────────────────────

describe('renderItem — guards', () => {
  it('does not write anything for negative positions', () => {
    const rom = makeSyntheticRom();
    const grid = new CanvasGrid(16, 15, 3, 1, true);
    renderItem(grid, regularItem(0x29, -1, 5), rom, 0, testHeader());
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 15; y++) {
        expect(grid.getItem(x, y).visible).toBe(false);
      }
    }
  });
});
