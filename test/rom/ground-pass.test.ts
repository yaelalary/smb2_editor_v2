import { describe, it, expect } from 'vitest';
import { CanvasGrid } from '@/rom/canvas-grid';
import { groundPass, type GroundSegment } from '@/rom/ground-pass';

/**
 * Synthetic ROM utility — seeds the bytes consumed by `getBgSet` and
 * `getBgTile` so we can assert groundPass writes without needing real
 * ROM fixtures.
 *
 * Note about the bgSet table layout: C++ and our port both compute the
 * vertical bgSet address as `0xd210 + 0x7c + 4*bgSet`. Since 0x7c = 124
 * = 31*4, horizontal bgSet=0x1F (at 0xd28c) physically coincides with
 * vertical bgSet=0. The real ROM exploits this overlap. In tests we
 * create per-direction fixtures so horizontal 0x1F writes don't collide
 * with vertical bgSet=0 writes.
 */
function writeDword(rom: Uint8Array, off: number, dw: number): void {
  rom[off + 0] = (dw >>> 24) & 0xff;
  rom[off + 1] = (dw >>> 16) & 0xff;
  rom[off + 2] = (dw >>> 8) & 0xff;
  rom[off + 3] = dw & 0xff;
}

function makeHorizRom(): Uint8Array {
  const rom = new Uint8Array(0x20000);
  const ptrTarget = 0x10000;
  const ptrEncoded = ptrTarget - 0x4010;
  rom[0xc438] = ptrEncoded & 0xff;         // world 0 horiz lo
  rom[0xc446] = (ptrEncoded >> 8) & 0xff;  // world 0 horiz hi

  // Ground tile table (4*bgType + bgSet): bgSet 0..3 with distinct IDs.
  rom[ptrTarget + 0] = 0x10;
  rom[ptrTarget + 1] = 0x11;
  rom[ptrTarget + 2] = 0x22;
  rom[ptrTarget + 3] = 0x33;

  // Horizontal bgSet DWORD table.
  writeDword(rom, 0xd210 + 4 * 0, 0x55555555);        // bgSet=0: bitset=1 across
  writeDword(rom, 0xd210 + 4 * 1, 0x00000000);        // bgSet=1: all holes
  writeDword(rom, 0xd210 + 4 * 2, 0xaaaaaaaa);        // bgSet=2: bitset=2 across
  writeDword(rom, 0xd210 + 4 * 0x1f, 0xffffffff);     // bgSet=0x1F: bitset=3 across
  return rom;
}

function makeVertRom(): Uint8Array {
  const rom = new Uint8Array(0x20000);
  const ptrTarget = 0x10000;
  const ptrEncoded = ptrTarget - 0x4010;
  rom[0xc43f] = ptrEncoded & 0xff;         // world 0 vert lo
  rom[0xc44d] = (ptrEncoded >> 8) & 0xff;  // world 0 vert hi

  rom[ptrTarget + 0] = 0x10;
  rom[ptrTarget + 1] = 0x11;
  rom[ptrTarget + 2] = 0x22;
  rom[ptrTarget + 3] = 0x33;

  writeDword(rom, 0xd210 + 0x7c + 4 * 0, 0x55555555);
  writeDword(rom, 0xd210 + 0x7c + 4 * 0x1f, 0xffffffff);
  return rom;
}

describe('groundPass — horizontal level', () => {
  const rom = makeHorizRom();

  it('fills every cell with bitset=1 ground when DWORD is 0x55555555', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const segments: GroundSegment[] = [{ startPos: 0, groundSet: 0, groundType: 0 }];
    groundPass(grid, rom, 0, segments);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const c = grid.getItem(x, y);
        expect(c.visible).toBe(true);
        expect(c.type).toBe(1);
        expect(c.tileId).toBe(0x11);
      }
    }
  });

  it('marks every cell as a hole when DWORD is 0', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const segments: GroundSegment[] = [{ startPos: 0, groundSet: 1, groundType: 0 }];
    groundPass(grid, rom, 0, segments);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(grid.getItem(x, y).visible).toBe(false);
      }
    }
  });

  it('skips the initial 0x1F segment (DrawGroundEx line 632)', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const segments: GroundSegment[] = [
      { startPos: 0, groundSet: 0x1f, groundType: 0 }, // initial 0x1F → skip
    ];
    groundPass(grid, rom, 0, segments);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(grid.getItem(x, y).visible).toBe(false);
      }
    }
  });

  it('does NOT skip a stream 0x1F segment (only segment index 0 is special)', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const segments: GroundSegment[] = [
      { startPos: 0, groundSet: 0, groundType: 0 },
      { startPos: 2, groundSet: 0x1f, groundType: 0 },
    ];
    groundPass(grid, rom, 0, segments);

    // col 0-1 stays as first segment (bitset=1 everywhere)
    expect(grid.getItem(0, 0).type).toBe(1);
    expect(grid.getItem(1, 0).type).toBe(1);
    // col 2-3 gets the 0xFFFFFFFF pattern: bitset=3 across → tileId=0x33 from the ROM table
    expect(grid.getItem(2, 0).type).toBe(3);
    expect(grid.getItem(2, 0).tileId).toBe(0x33);
    expect(grid.getItem(3, 3).type).toBe(3);
  });

  it('later segment overrides earlier from its startPos to the end of the axis', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    const segments: GroundSegment[] = [
      { startPos: 0, groundSet: 0, groundType: 0 },     // bitset=1 everywhere
      { startPos: 2, groundSet: 1, groundType: 0 },     // override cols 2-3 → holes
    ];
    groundPass(grid, rom, 0, segments);

    // cols 0-1 keep the initial bitset=1 ground
    for (let y = 0; y < 4; y++) {
      expect(grid.getItem(0, y).type).toBe(1);
      expect(grid.getItem(1, y).type).toBe(1);
    }
    // cols 2-3 are cleared to holes by the override segment
    for (let y = 0; y < 4; y++) {
      expect(grid.getItem(2, y).visible).toBe(false);
      expect(grid.getItem(3, y).visible).toBe(false);
    }
  });
});

describe('groundPass — vertical level', () => {
  const rom = makeVertRom();

  it('uses the vertical gSet table (offset +0x7c) and writes rows from startPos', () => {
    const grid = new CanvasGrid(4, 4, 0, 0, false);
    const segments: GroundSegment[] = [{ startPos: 0, groundSet: 0, groundType: 0 }];
    groundPass(grid, rom, 0, segments);

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(grid.getItem(x, y).visible).toBe(true);
        expect(grid.getItem(x, y).tileId).toBe(0x11);
      }
    }
  });
});

describe('groundPass — invisible-solid cells (tile 0xFF)', () => {
  it('writes cells as visible with tileId=0xFF when the ROM returns 0xFF', () => {
    const rom = makeHorizRom();
    rom[0x10001] = 0xff; // overwrite bgSet=1 tile to 0xFF
    const grid = new CanvasGrid(4, 4, 0, 0, true);
    groundPass(grid, rom, 0, [{ startPos: 0, groundSet: 0, groundType: 0 }]);
    const cell = grid.getItem(0, 0);
    expect(cell.visible).toBe(true);
    expect(cell.tileId).toBe(0xff);
    expect(cell.type).toBe(1);
  });
});
