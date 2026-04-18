/**
 * ROM tile ID reader — ports every Get*Dim function from the C++ tool's
 * `cneseditor_tiles.cpp`. Each function reads tile IDs from specific ROM
 * addresses and returns an NesItemDim describing how to assemble the
 * multi-tile visual for an item.
 *
 * The atlas index (type field in C++) is always 4 for items read here.
 * Ground tiles use atlases 0-3 based on the world FX value.
 */

import type { NesItemDim } from './nesleveldef';

// ─── Helpers ───────────────────────────────────────────────────────

function rd(rom: Uint8Array, addr: number): number {
  return rom[addr] ?? 0;
}

function emptyDim(): NesItemDim {
  return {
    topleft: 0xff, top: 0xff, topright: 0xff,
    left: 0xff, right: 0xff, middle: 0xff,
    bottomleft: 0xff, bottomright: 0xff,
  };
}

// ─── GetSingDim ────────────────────────────────────────────────────

/**
 * Single-tile items: 0-5, 0x10, 0x11, 0x20-0x2F.
 * Returns the NesItemDim with at least `topleft` filled in.
 */
export function getSingDim(
  rom: Uint8Array,
  itemId: number,
  world: number,
  fallback: NesItemDim,
): NesItemDim {
  const nid = { ...fallback };

  switch (itemId) {
    case 0x00: case 0x01: case 0x02:
    case 0x03: case 0x04: case 0x05: {
      const castleWorld = rd(rom, 0xcb72);
      const ptr = (castleWorld === world ? 0xcb57 : 0xcb50) + itemId;
      nid.topleft = rd(rom, ptr);
      return nid;
    }
    case 0x10: { // big cloud (2 tiles)
      nid.topleft = rd(rom, 0xccc2);
      nid.topright = rd(rom, 0xccc7);
      return nid;
    }
    case 0x11: { // small cloud
      nid.topleft = rd(rom, 0xccce);
      return nid;
    }
    case 0x20: case 0x21: case 0x22: case 0x23:
    case 0x24: case 0x25: case 0x26: case 0x27:
    case 0x28: case 0x29: case 0x2a:
    // 0x2b skipped (space mushroom)
    case 0x2c:
    // 0x2d skipped (space mushroom)
    case 0x2e: case 0x2f: {
      nid.topleft = rd(rom, 0xcd40 + (itemId & 0x0f));
      return nid;
    }
    default:
      return nid;
  }
}

// ─── GetHorzDim ────────────────────────────────────────────────────

/**
 * Horizontal connectable items: 0x0A (bridge), 0x0B (chain).
 * Returns topleft, middle, topright.
 */
export function getHorzDim(
  rom: Uint8Array,
  itemId: number,
  world: number,
  fallback: NesItemDim,
): NesItemDim {
  const nid = { ...fallback };

  if (itemId === 0x0a || itemId === 0x0b) {
    const castleWorld = rd(rom, 0xcb8b);
    const off = itemId - 0x0a;
    if (castleWorld === world) {
      nid.topleft = rd(rom, 0xcf5a + off);
      nid.middle = rd(rom, 0xcf5d + off);
      nid.topright = rd(rom, 0xcf5f + off);
    } else {
      nid.topleft = rd(rom, 0xcb81 + off);
      nid.middle = rd(rom, 0xcb83 + off);
      nid.topright = rd(rom, 0xcb85 + off);
    }
  }

  return nid;
}

// ─── GetVertDim ────────────────────────────────────────────────────

/**
 * Vertical extending items: 0x06-0x08 (jars), 0x0C-0x0D (vines),
 * 0x0F (per-world pillar), 0x12 (vine-to-top), 0x16 (tree).
 * Returns topleft, middle, bottomleft.
 */
export function getVertDim(
  rom: Uint8Array,
  itemId: number,
  world: number,
  fallback: NesItemDim,
): NesItemDim {
  const nid = { ...fallback };

  let ptrTop = 0;
  let ptrMiddle = 0;
  let ptrBottom = 0;

  switch (itemId) {
    case 0x06: case 0x07: case 0x08:
      ptrTop = 0xccd2 + (itemId - 0x06);
      ptrMiddle = 0xcced;
      ptrBottom = 0xccf9;
      break;
    case 0x0c:
      ptrTop = 0xcd07;
      ptrMiddle = 0xcd14;
      ptrBottom = ptrMiddle;
      break;
    case 0x0d:
      ptrTop = 0xcd14;
      ptrMiddle = 0xcd14;
      ptrBottom = ptrMiddle;
      break;
    case 0x12:
      ptrBottom = 0xcd26;
      ptrMiddle = ptrTop = 0xcd39;
      break;
    case 0x16:
      ptrTop = 0xcc63;
      ptrBottom = ptrMiddle = 0xcc65;
      break;
    case 0x0f:
      ptrBottom = ptrTop = 0xd0d5 + world;
      ptrMiddle = 0xd0dc + world;
      break;
    default:
      return nid;
  }

  nid.topleft = rd(rom, ptrTop);
  nid.middle = rd(rom, ptrMiddle);
  nid.bottomleft = (ptrBottom === ptrTop) ? nid.topleft : rd(rom, ptrBottom);

  return nid;
}

// ─── GetMasvDim ────────────────────────────────────────────────────

/**
 * Mass/large items: 0x08 (mushroom platform), 0x09 (locked door platform),
 * 0x0C (vine mass), 0x18-0x19 (brick walls).
 * Returns all 8 tile fields for a rectangular fill.
 */
export function getMasvDim(
  rom: Uint8Array,
  itemId: number,
  world: number,
  fallback: NesItemDim,
): NesItemDim {
  const nid = { ...fallback };

  switch (itemId) {
    case 0x18: case 0x19: {
      const castleWorld = rd(rom, 0xcd7f);
      const off = itemId - 0x18;
      if (castleWorld === world) {
        nid.topleft = rd(rom, 0xcd5c + off);
      } else {
        nid.topleft = rd(rom, 0xcd5a + off);
      }
      nid.top = nid.topright = nid.left = nid.middle = nid.right = nid.topleft;
      break;
    }
    case 0x09: {
      const castleWorld = rd(rom, 0xcbc7);
      if (castleWorld === world) {
        nid.topleft = rd(rom, 0xd06c);
        nid.top = rd(rom, 0xd070);
        nid.topright = rd(rom, 0xd074);
        nid.left = rd(rom, 0xd06d);
        nid.middle = rd(rom, 0xd071);
        nid.right = rd(rom, 0xd075);
        nid.bottomleft = nid.left;
        nid.bottomright = nid.right;
      } else {
        nid.topleft = rd(rom, 0xcbba);
        nid.top = rd(rom, 0xcbbb);
        nid.topright = rd(rom, 0xcbbc);
        nid.left = rd(rom, 0xcbbd);
        nid.middle = rd(rom, 0xcbbe);
        nid.right = rd(rom, 0xcbbf);
        nid.bottomleft = nid.left;
        nid.bottomright = nid.right;
      }
      break;
    }
    case 0x08: {
      const castleWorld = rd(rom, 0xcecc);
      if (castleWorld === world) {
        nid.topleft = rd(rom, 0xd128);
        nid.top = nid.topright = nid.topleft;
        nid.left = nid.right = nid.middle = nid.topleft;
      } else {
        nid.topleft = rd(rom, 0xce92);
        nid.top = rd(rom, 0xce97);
        nid.topright = rd(rom, 0xce9c);
        nid.left = rd(rom, 0xce93);
        nid.middle = rd(rom, 0xce98);
        nid.right = rd(rom, 0xce9d);
        nid.bottomleft = nid.bottomright = 0x11;
      }
      break;
    }
    case 0x0c: {
      const castleWorld = rd(rom, 0xcda9);
      if (castleWorld === world) {
        nid.top = rd(rom, 0xcf24);
        nid.topleft = nid.topright = nid.middle = nid.top;
        nid.left = nid.right = nid.middle;
      } else {
        nid.top = rd(rom, 0xcda3);
        nid.middle = rd(rom, 0xcda4);
        nid.topleft = nid.topright = nid.top;
        nid.left = nid.right = nid.middle;
      }
      break;
    }
    default:
      return nid;
  }

  return nid;
}

// ─── GetEntrDim ────────────────────────────────────────────────────

/**
 * Entrance/door items (entrance-type items only): 9-11, 19-20, 28-29.
 * Returns tile IDs for door shapes.
 */
export function getEntrDim(
  rom: Uint8Array,
  itemId: number,
  world: number,
  fallback: NesItemDim,
): NesItemDim {
  const nid = { ...fallback };

  switch (itemId) {
    case 9: case 10: case 11:
    case 28: case 29: {
      const norm = itemId > 16 ? itemId - 16 : itemId;
      nid.topleft = rd(rom, 0xd026 + (norm - 9));
      nid.bottomleft = rd(rom, 0xd02b + (norm - 9));
      break;
    }
    case 19: { // light entrance left
      const castleWorld = rd(rom, 0xca75);
      if (castleWorld === world) {
        nid.topright = 0xff;
        nid.topleft = rd(rom, 0xcab9);
        nid.bottomleft = rd(rom, 0xcab9);
        nid.top = rd(rom, 0xcace);
        nid.bottomright = rd(rom, 0xcace);
        nid.middle = rd(rom, 0xcac5);
      } else {
        nid.topright = 0x00;
        nid.topleft = rd(rom, 0xca7e);
        nid.bottomleft = rd(rom, 0xca8d);
        nid.top = rd(rom, 0xca83);
        nid.bottomright = rd(rom, 0xca97);
        nid.middle = rd(rom, 0xca92);
      }
      break;
    }
    case 20: { // light entrance right
      nid.topright = rd(rom, 0xcae3);
      nid.bottomright = rd(rom, 0xcaf3);
      nid.top = rd(rom, 0xcae8);
      nid.bottomleft = rd(rom, 0xcafd);
      nid.middle = rd(rom, 0xcaf8);
      break;
    }
    default:
      return nid;
  }

  return nid;
}

// ─── GetObjTile ────────────────────────────────────────────────────

/**
 * Object tile for extended items (>= 0x30). Reads from a per-world
 * pointer table in ROM. Used by DrawHorzGrObjectEx / DrawVertGrObjectEx.
 */
export function getObjTile(
  rom: Uint8Array,
  objectId: number,
  world: number,
  objectType: number,
): number {
  if (objectId < 0 || objectId > 8) return 0;

  const bObjectTypePtr = objectId >= 7
    ? Math.floor(objectType / 4)
    : objectType % 4;

  const bLowPtr = rd(rom, 0xc911 + world);
  const bHiPtr = rd(rom, 0xc918 + world);
  const ptr = ((bHiPtr << 8) | bLowPtr) + 0x4010;

  return rd(rom, ptr + 4 * objectId + bObjectTypePtr);
}

// ─── GetBgSet ──────────────────────────────────────────────────────

/**
 * Ground set bitmask (32-bit DWORD). Each pair of bits (from MSB)
 * indicates the ground tile type (0-3) for a row/column.
 */
export function getBgSet(
  rom: Uint8Array,
  bgSet: number,
  isHorizontal: boolean,
): number {
  if (bgSet >= 32) return 0;

  const addr = 0xd210 + (isHorizontal ? 0 : 0x7c) + 4 * bgSet;
  // Read 4 bytes big-endian (C++ loads little-endian DWORD then SWAP_DWORD)
  const b0 = rd(rom, addr);
  const b1 = rd(rom, addr + 1);
  const b2 = rd(rom, addr + 2);
  const b3 = rd(rom, addr + 3);
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}

// ─── GetBgTile ─────────────────────────────────────────────────────

/**
 * Ground tile ID for a specific (bgSet, bgType) in a given world.
 * Reads from the ROM's per-world ground tile pointer table.
 */
export function getBgTile(
  rom: Uint8Array,
  bgSet: number,
  bgType: number,
  world: number,
  isHorizontal: boolean,
): number {
  if (world < 0 || world >= 7 || bgSet >= 4 || bgType >= 8) return 0xff;

  const loAddr = (isHorizontal ? 0xc438 : 0xc43f) + world;
  const hiAddr = (isHorizontal ? 0xc446 : 0xc44d) + world;
  const bLowPtr = rd(rom, loAddr);
  const bHiPtr = rd(rom, hiAddr);
  const ptr = 0x4010 + ((bHiPtr << 8) | bLowPtr);

  if (ptr <= 0) return 0xff;

  return rd(rom, ptr + 4 * bgType + bgSet);
}

// ─── GetFX (world gfx theme index) ─────────────────────────────────

/**
 * g_mWorldInterior table from C++ nesleveldef.cpp:1604.
 * Matches (bHi << 8 | bLow) read from ROM to a gfx theme index 0-4:
 *   0 = night, 1 = day, 2 = desert, 3 = winter, 4 = castle.
 * These drive which BG ground atlas (bgN.bmp) to use.
 */
const WORLD_INTERIOR: ReadonlyArray<number> = [
  0x0a0c, // night
  0x100c, // day
  0x120d, // desert
  0x140e, // winter
  0x160f, // castle
];

/**
 * Per-world gfx theme index (0-4). Reads ROM pointer table at
 * 0x1fe10 / 0x1fe17 and matches against g_mWorldInterior.
 * Mirrors C++ CNesEditor::GetFX in cneseditor_editor.cpp:405.
 */
export function getWorldGfx(rom: Uint8Array, world: number): number {
  if (world < 0 || world >= 7) return 0;
  const bLow = rd(rom, 0x1fe10 + world);
  const bHi = rd(rom, 0x1fe17 + world);
  const key = bLow | (bHi << 8);
  for (let i = 0; i < WORLD_INTERIOR.length; i++) {
    if (WORLD_INTERIOR[i] === key) return i;
  }
  return 0;
}

export { emptyDim };
