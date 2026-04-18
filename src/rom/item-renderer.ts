/**
 * Item renderer — computes all tiles that compose a level item.
 *
 * Faithfully ports the C++ tool's Draw*ObjectEx dispatch from
 * `clvldraw_worker.cpp`. Given a level item plus context (slot, header,
 * ROM), returns an array of positioned tiles ready for canvas blitting.
 *
 * Atlas selection per world theme (mirrors UseGamma(uColor, fx+4, ...)):
 *   fx=0 → atlas 4 (interior)    [World 7]
 *   fx=1 → atlas 5 (desert/ice)  [World 4]
 *   fx=2 → atlas 6 (castle)      [Worlds 2, 6]
 *   fx=3 → atlas 7 (underground) [Worlds 1, 3, 5]
 *
 * This module is pure computation — no DOM, no canvas, no side effects.
 */

import type { LevelItem, LevelHeader } from './model';
import type { NesItemDim } from './nesleveldef';
import {
  ITEM_DIM,
  SITEM_DIM,
  GROUND_TYPE_H,
  GROUND_TYPE_V,
} from './nesleveldef';
import { getBgSet, getObjTile, getWorldGfx, getHorzDim, emptyDim } from './tile-reader';
import { getFxForSlot } from './level-layout';

// ─── Public types ──────────────────────────────────────────────────

export interface RenderedTile {
  /** Tile ID (0-255) — index into the atlas. */
  tileId: number;
  /**
   * Atlas index:
   *   - When `isBgStrip` is false: 4-7 = item atlases (fx+4, 256×256 grid),
   *     8 = enemy atlas.
   *   - When `isBgStrip` is true: 0-4 = BG ground strip (4096×16, per gfx).
   */
  atlasIndex: number;
  /** Canvas tile X (absolute). */
  x: number;
  /** Canvas tile Y (absolute). */
  y: number;
  /**
   * If true, tileId indexes into a BG strip atlas (bgN.bmp, 4096×16).
   * Set for items rendered via C++ DrawHorzGrObjectEx/DrawVertGrObjectEx
   * which use GetObjTile + type=4 → DrawGrGamma in DrawCanvas.
   */
  isBgStrip?: boolean;
}

// ─── Internal helpers ──────────────────────────────────────────────

function fallbackDim(itemId: number): NesItemDim {
  const raw = ITEM_DIM[itemId];
  if (!raw) return emptyDim();
  return {
    topleft: raw[0] ?? 0xff, top: raw[1] ?? 0xff, topright: raw[2] ?? 0xff,
    left: raw[3] ?? 0xff, right: raw[4] ?? 0xff, middle: raw[5] ?? 0xff,
    bottomleft: raw[6] ?? 0xff, bottomright: raw[7] ?? 0xff,
  };
}

/**
 * Compute the first ground row (topmost Y with ground) for a column.
 * Used to stop vines from extending through the ground.
 * Returns canvasHeight if no ground exists.
 */
export function firstGroundRow(
  rom: Uint8Array,
  slot: number,
  isHorizontal: boolean,
  groundSet: number,
  canvasHeight: number,
): number {
  const dwGroundSet = getBgSet(rom, groundSet & 0x1f, isHorizontal);
  if (dwGroundSet === 0) return canvasHeight;

  for (let row = 0; row < canvasHeight; row++) {
    const bit = 30 - row * 2;
    if (((dwGroundSet >>> bit) & 0x03) !== 0) return row;
  }
  return canvasHeight;
}

function pushTile(
  out: RenderedTile[],
  tileId: number,
  x: number,
  y: number,
  atlas: number,
): void {
  if (tileId !== 0xff) {
    out.push({ tileId, atlasIndex: atlas, x, y });
  }
}

// ─── Draw functions ────────────────────────────────────────────────

function renderSingle(
  _rom: Uint8Array, itemId: number, _world: number,
  x: number, y: number, atlas: number,
): RenderedTile[] {
  const dim = fallbackDim(itemId);
  const out: RenderedTile[] = [];
  pushTile(out, dim.topleft, x, y, atlas);
  return out;
}

/**
 * Render a horizontal extended item (vid 10, 11 — log bridge, red platform,
 * etc.). C++ DrawHorzObjectEx calls GetHorzDim which reads tile IDs from
 * ROM and sets type=4 → BG strip atlas routing.
 */
function renderHorizontal(
  rom: Uint8Array, rawId: number, world: number, gfx: number,
  x: number, y: number,
): RenderedTile[] {
  const id = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;
  const size = (rawId - 0x30) & 0x0f;

  // C++ GetHorzDim: ROM-read tile IDs for items 0x0A, 0x0B.
  const dim = getHorzDim(rom, id, world, fallbackDim(id));

  const out: RenderedTile[] = [];
  pushBgTile(out, dim.topleft, x, y, gfx);
  pushBgTile(out, dim.topright, x + size, y, gfx);
  for (let i = 1; i < size; i++) {
    pushBgTile(out, dim.middle, x + i, y, gfx);
  }
  return out;
}

function renderVertical(
  _rom: Uint8Array, rawId: number, _world: number,
  posX: number, posY: number,
  isInverted: boolean, isHorizontalLevel: boolean, atlas: number,
): RenderedTile[] {
  let id: number;
  let size: number;

  if (rawId >= 0x30) {
    id = Math.floor((rawId - 0x30) / 0x10);
    size = rawId & 0x0f;
  } else {
    id = rawId;
    size = 0x0f * Math.floor((posY + 0x0f) / 0x0f) - posY - 1;
  }

  const dim = fallbackDim(id);
  const out: RenderedTile[] = [];

  if (!isInverted) {
    if (id === 0x0c || id === 0x0d || id === 0x0f) size += 0x0f;

    pushTile(out, dim.topleft, posX, posY, atlas);
    for (let i = 1; i < size; i++) {
      pushTile(out, dim.middle, posX, posY + i, atlas);
    }
    if (size > 0) {
      pushTile(out, dim.bottomleft, posX, posY + size, atlas);
    }
  } else {
    pushTile(out, dim.bottomleft, posX, posY, atlas);
    let minY = Math.max(posY - 0x0f, 0);
    if (id === 0x12 && !isHorizontalLevel && minY > 0) {
      minY = (1 + Math.floor(minY / 0x0f)) * 0x0f;
    }
    for (let cy = posY - 1; cy > minY; cy--) {
      pushTile(out, dim.middle, posX, cy, atlas);
    }
    pushTile(out, dim.topleft, posX, minY, atlas);
  }
  return out;
}

function renderMassive(
  _rom: Uint8Array, rawId: number, _world: number,
  posX: number, posY: number, atlas: number,
  fx?: number, objectType?: number,
): RenderedTile[] {
  const sizeX = rawId >= 0x30 ? ((rawId - 0x30) & 0x0f) : 5;
  const sizeY = 0x0e;
  const idRegular = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;

  // Use static tables (grid-compatible tile IDs).
  // For extended mass items (vid 8,9,12), try SITEM_DIM first.
  // For regular mass items (24,25), use ITEM_DIM which has all 8 positions.
  let dim: NesItemDim;
  if (rawId >= 0x30 && fx !== undefined && objectType !== undefined) {
    const extDim = SITEM_DIM[fx]?.[objectType]?.[idRegular];
    dim = extDim ? {
      topleft: extDim[0] ?? 0xff, top: extDim[1] ?? 0xff, topright: extDim[2] ?? 0xff,
      left: extDim[3] ?? 0xff, right: extDim[4] ?? 0xff, middle: extDim[5] ?? 0xff,
      bottomleft: extDim[6] ?? 0xff, bottomright: extDim[7] ?? 0xff,
    } : fallbackDim(idRegular);
  } else {
    dim = fallbackDim(idRegular);
  }
  const out: RenderedTile[] = [];

  pushTile(out, dim.topleft, posX, posY, atlas);
  pushTile(out, dim.topright, posX + sizeX, posY, atlas);
  for (let cx = 1; cx < sizeX; cx++) {
    pushTile(out, dim.top, posX + cx, posY, atlas);
  }
  for (let cy = 1; cy <= sizeY; cy++) {
    for (let cx = 0; cx <= sizeX; cx++) {
      const tid = cx === 0 ? dim.left : (cx < sizeX ? dim.middle : dim.right);
      pushTile(out, tid, posX + cx, posY + cy, atlas);
    }
  }
  return out;
}

/**
 * Push a tile that samples from the BG strip atlas (bgN.bmp).
 * Mirrors C++ DrawCanvas branch: type!=0 → DrawGrGamma (grtpl).
 */
function pushBgTile(
  out: RenderedTile[],
  tileId: number,
  x: number,
  y: number,
  gfx: number,
): void {
  if (tileId !== 0xff) {
    out.push({ tileId, atlasIndex: gfx, x, y, isBgStrip: true });
  }
}

function renderHorzGround(
  rom: Uint8Array, rawId: number, world: number, objectType: number, gfx: number,
  posX: number, posY: number,
): RenderedTile[] {
  const vid = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;
  const size = (rawId - 0x30) & 0x0f;
  // C++ DrawHorzGrObjectEx: idTile = GetObjTile(id). ROM read, not static.
  const tileId = getObjTile(rom, vid, world, objectType);
  const out: RenderedTile[] = [];
  for (let i = 0; i <= size; i++) {
    pushBgTile(out, tileId, posX + i, posY, gfx);
  }
  return out;
}

function renderVertGround(
  rom: Uint8Array, rawId: number, world: number, objectType: number, gfx: number,
  posX: number, posY: number,
): RenderedTile[] {
  let vid: number;
  let size: number;
  if (rawId >= 0x30) {
    size = rawId & 0x0f;
    vid = Math.floor((rawId - 0x30) / 0x10);
  } else {
    vid = rawId;
    size = 0x0f * Math.floor((posY + 0x0f) / 0x0f) - posY;
  }

  // C++ DrawVertGrObjectEx: idTile = GetObjTile(id). ROM read, not static.
  const tileId = getObjTile(rom, vid, world, objectType);
  const out: RenderedTile[] = [];

  pushBgTile(out, tileId, posX, posY, gfx);
  for (let i = 1; i <= size; i++) {
    pushBgTile(out, tileId, posX, posY + i, gfx);
  }
  return out;
}

function renderSpecialRegular(
  _rom: Uint8Array, rawId: number, _world: number,
  posX: number, posY: number, atlas: number,
): RenderedTile[] {
  const out: RenderedTile[] = [];
  switch (rawId) {
    case 14: pushTile(out, 0xfe, posX, posY, atlas); break;
    case 16: {
      const dim = fallbackDim(rawId);
      pushTile(out, dim.topleft, posX, posY, atlas);
      pushTile(out, dim.topright, posX + 1, posY, atlas);
      break;
    }
    case 23: pushTile(out, 0xfb, posX, posY, atlas); break;
    case 30: case 31:
      pushTile(out, rawId === 30 ? 0xfc : 0xfd, posX, posY, atlas);
      break;
  }
  return out;
}

function renderEntrance(
  _rom: Uint8Array, rawId: number, _world: number,
  posX: number, posY: number, atlas: number,
): RenderedTile[] {
  const dim = fallbackDim(rawId);
  const out: RenderedTile[] = [];
  switch (rawId) {
    case 9: case 10: case 11: case 28: case 29:
      pushTile(out, dim.topleft, posX, posY, atlas);
      pushTile(out, dim.bottomleft, posX, posY + 1, atlas);
      break;
    case 19:
      pushTile(out, dim.topleft, posX, posY, atlas);
      pushTile(out, dim.bottomleft, posX, posY + 1, atlas);
      pushTile(out, dim.top, posX + 1, posY, atlas);
      pushTile(out, dim.middle, posX + 1, posY + 1, atlas);
      pushTile(out, dim.bottomright, posX + 2, posY + 1, atlas);
      break;
    case 20:
      pushTile(out, dim.bottomleft, posX - 2, posY + 1, atlas);
      pushTile(out, dim.top, posX - 1, posY, atlas);
      pushTile(out, dim.middle, posX - 1, posY + 1, atlas);
      pushTile(out, dim.topright, posX, posY, atlas);
      pushTile(out, dim.bottomright, posX, posY + 1, atlas);
      break;
    case 21: case 30:
      pushTile(out, 0xfc, posX, posY, atlas);
      break;
  }
  return out;
}

// ─── Main dispatch ─────────────────────────────────────────────────

/**
 * Compute all tiles for a level item, mirroring DrawObjectEx dispatch.
 *
 * Items extend to their full size. The C++ SetCanvasItem priority system
 * (bgPriority=1 items blocked by ground) is emulated at the canvas level
 * by filtering tiles against the ground grid — see drawItemOnCanvas.
 */
export function renderItem(
  rom: Uint8Array,
  item: LevelItem,
  slot: number,
  header: LevelHeader,
): RenderedTile[] {
  if (item.tileX < 0 || item.tileY < 0) return [];

  const world = Math.floor(slot / 30);
  const fx = getFxForSlot(slot);
  const atlas = fx + 4; // item atlas: 4=interior, 5=desert, 6=castle, 7=underground
  const gfx = getWorldGfx(rom, world); // BG atlas index for horz/vert ground extended items
  const isH = header.direction === 1;
  const rawId = item.itemId;
  const objType = header.objectType & 0x0f;

  if (item.kind === 'entrance') {
    return renderEntrance(rom, rawId, world, item.tileX, item.tileY, atlas);
  }
  if (item.kind !== 'regular') return [];

  // ─── Regular item dispatch (mirrors DrawObjectEx switch) ────────
  switch (rawId) {
    case 6: case 7: case 8: case 12: case 13: case 15: case 22:
      return renderVertical(rom, rawId, world, item.tileX, item.tileY, false, isH, atlas);
    case 18:
      return renderVertical(rom, rawId, world, item.tileX, item.tileY, true, isH, atlas);
    case 0: case 1: case 2: case 3: case 4: case 5: case 17:
    case 32: case 33: case 34: case 35: case 36: case 37:
    case 38: case 39: case 40: case 41: case 42: case 43:
    case 44: case 45: case 46: case 47:
      return renderSingle(rom, rawId, world, item.tileX, item.tileY, atlas);
    case 24: case 25:
      return renderMassive(rom, rawId, world, item.tileX, item.tileY, atlas);
    case 14: case 16: case 23: case 30: case 31:
      return renderSpecialRegular(rom, rawId, world, item.tileX, item.tileY, atlas);
    default: {
      if (rawId < 0x30) return [];
      const vid = Math.floor((rawId - 0x30) / 0x10);
      switch (vid) {
        // HorzGr / VertGr: C++ type=4 → BG strip atlas, GetObjTile (ROM).
        case 0: case 1: case 2: case 3: case 4:
          return renderHorzGround(rom, rawId, world, objType, gfx, item.tileX, item.tileY);
        case 5: case 6: case 7:
          return renderVertGround(rom, rawId, world, objType, gfx, item.tileX, item.tileY);
        // vid 10/11 (log bridge, red platform, etc.): C++ GetHorzDim
        // reads tiles from ROM + sets type=4 → BG strip atlas.
        case 10: case 11:
          return renderHorizontal(rom, rawId, world, gfx, item.tileX, item.tileY);
        case 8: case 9: case 12:
          return renderMassive(rom, rawId, world, item.tileX, item.tileY, atlas, fx, header.objectType);
        default: return [];
      }
    }
  }
}

// ─── Ground rendering ──────────────────────────────────────────────

/**
 * Compute all ground tiles for a level using static tables.
 * GROUND_SET_H/V provides the bitmask (which rows have ground).
 * GROUND_TYPE_H/V provides the tile IDs per bitset variant.
 * Empirically verified via ?dev=rendering: LE gd() + static tables
 * give correct grass-on-top / dirt-below rendering.
 */
export function renderGround(
  rom: Uint8Array,
  slot: number,
  header: LevelHeader,
  canvasWidth: number,
  canvasHeight: number,
  groundSet: number,
  groundType: number,
  startX: number,
  startY: number,
): RenderedTile[] {
  const fx = getFxForSlot(slot);
  const isH = header.direction === 1;
  const out: RenderedTile[] = [];
  const groundAtlas = fx + 4;

  const gSetIdx = groundSet & 0x1f;
  if (gSetIdx === 0x1f) return out;

  // Bitmask from ROM (empirically correct), tile IDs from static tables
  // (grid-compatible). The static GROUND_SET tables don't match the ROM
  // for many levels, but getBgSet reads the correct per-level bitmask.
  const dwGroundSet = getBgSet(rom, gSetIdx, isH);
  if (dwGroundSet === 0) return out;

  const gtTable = isH ? GROUND_TYPE_H : GROUND_TYPE_V;

  const gtEntry = gtTable[fx]?.[groundType & 0x07];
  if (!gtEntry) return out;

  if (isH) {
    for (let cx = startX; cx < canvasWidth; cx++) {
      let bit = 30;
      for (let cy = 0; cy < canvasHeight; cy++) {
        const bitset = (dwGroundSet >>> bit) & 0x03;
        if (bitset !== 0) {
          const tileId = gtEntry[bitset];
          if (tileId !== undefined && tileId !== 0xff) {
            out.push({ tileId, atlasIndex: groundAtlas, x: cx, y: cy, isGround: true });
          }
        }
        bit -= 2;
      }
    }
  } else {
    for (let cy = startY; cy < canvasHeight; cy++) {
      let bit = 30;
      for (let cx = 0; cx < canvasWidth; cx++) {
        const bitset = (dwGroundSet >>> bit) & 0x03;
        if (bitset !== 0) {
          const tileId = gtEntry[bitset];
          if (tileId !== undefined && tileId !== 0xff) {
            out.push({ tileId, atlasIndex: groundAtlas, x: cx, y: cy, isGround: true });
          }
        }
        bit -= 2;
      }
    }
  }

  return out;
}
