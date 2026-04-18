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
  GROUND_TYPE_H,
  GROUND_TYPE_V,
} from './nesleveldef';
import {
  getBgSet, getObjTile, getWorldGfx,
  getSingDim, getHorzDim, getVertDim, getMasvDim, getEntrDim,
  isSingBg, isVertBg, isMasvBg, isEntrBg,
  emptyDim,
} from './tile-reader';
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
  rom: Uint8Array, itemId: number, world: number,
  x: number, y: number, atlas: number, gfx: number,
): RenderedTile[] {
  // C++ DrawSingleObjectEx calls GetSingDim which reads from ROM and
  // sets type=4 for known cases → BG atlas. Fallback → item atlas.
  const dim = getSingDim(rom, itemId, world, fallbackDim(itemId));
  const out: RenderedTile[] = [];
  if (isSingBg(itemId)) {
    pushBgTile(out, dim.topleft, x, y, gfx);
    // Item 0x10 (big cloud) also has a topright tile.
    if (itemId === 0x10) pushBgTile(out, dim.topright, x + 1, y, gfx);
  } else {
    pushTile(out, dim.topleft, x, y, atlas);
  }
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
  rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number,
  isInverted: boolean, isHorizontalLevel: boolean, atlas: number, gfx: number,
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

  // C++ DrawVertObjectEx calls GetVertDim: ROM tiles + type=4 for
  // known cases (jars 6-8, vines 12-13, pillar 15, vine-top 18, tree 22).
  const dim = getVertDim(rom, id, world, fallbackDim(id));
  const isBg = isVertBg(id);
  const emit = (tid: number, x: number, y: number): void => {
    if (isBg) pushBgTile(out, tid, x, y, gfx);
    else pushTile(out, tid, x, y, atlas);
  };

  const out: RenderedTile[] = [];

  if (!isInverted) {
    if (id === 0x0c || id === 0x0d || id === 0x0f) size += 0x0f;

    emit(dim.topleft, posX, posY);
    for (let i = 1; i < size; i++) {
      emit(dim.middle, posX, posY + i);
    }
    if (size > 0) {
      emit(dim.bottomleft, posX, posY + size);
    }
  } else {
    emit(dim.bottomleft, posX, posY);
    let minY = Math.max(posY - 0x0f, 0);
    if (id === 0x12 && !isHorizontalLevel && minY > 0) {
      minY = (1 + Math.floor(minY / 0x0f)) * 0x0f;
    }
    for (let cy = posY - 1; cy > minY; cy--) {
      emit(dim.middle, posX, cy);
    }
    emit(dim.topleft, posX, minY);
  }
  return out;
}

function renderMassive(
  rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number, atlas: number, gfx: number,
): RenderedTile[] {
  const sizeX = rawId >= 0x30 ? ((rawId - 0x30) & 0x0f) : 5;
  const sizeY = 0x0e;
  const idRegular = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;

  // C++ DrawMasvObjectEx calls GetMasvDim: ROM tiles + type=4 for known
  // cases (0x08, 0x09, 0x0C vid items, 0x18/0x19 bricks). Covers
  // waterfall, green platform, brick background/wall.
  const dim = getMasvDim(rom, idRegular, world, fallbackDim(idRegular));
  const isBg = isMasvBg(idRegular);
  const emit = (tid: number, x: number, y: number): void => {
    if (isBg) pushBgTile(out, tid, x, y, gfx);
    else pushTile(out, tid, x, y, atlas);
  };

  const out: RenderedTile[] = [];

  emit(dim.topleft, posX, posY);
  emit(dim.topright, posX + sizeX, posY);
  for (let cx = 1; cx < sizeX; cx++) {
    emit(dim.top, posX + cx, posY);
  }
  for (let cy = 1; cy <= sizeY; cy++) {
    for (let cx = 0; cx <= sizeX; cx++) {
      const tid = cx === 0 ? dim.left : (cx < sizeX ? dim.middle : dim.right);
      emit(tid, posX + cx, posY + cy);
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
  rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number, atlas: number, gfx: number,
): RenderedTile[] {
  const out: RenderedTile[] = [];
  switch (rawId) {
    case 14: pushTile(out, 0xfe, posX, posY, atlas); break; // star bg sentinel
    case 16: {
      // Big cloud: GetSingDim reads from ROM + type=4 → BG atlas.
      const dim = getSingDim(rom, rawId, world, fallbackDim(rawId));
      pushBgTile(out, dim.topleft, posX, posY, gfx);
      pushBgTile(out, dim.topright, posX + 1, posY, gfx);
      break;
    }
    case 23: pushTile(out, 0xfb, posX, posY, atlas); break; // pyramid sentinel
    case 30: case 31:
      pushTile(out, rawId === 30 ? 0xfc : 0xfd, posX, posY, atlas); // desert/red bg sentinel
      break;
  }
  return out;
}

function renderEntrance(
  rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number, atlas: number, gfx: number,
): RenderedTile[] {
  // C++ DrawSpecialObjectEx (entrance branch) calls GetEntrDim: ROM +
  // type=4 for doors (9-11, 28-29) and light entrances (19, 20).
  const dim = getEntrDim(rom, rawId, world, fallbackDim(rawId));
  const isBg = isEntrBg(rawId);
  const emit = (tid: number, x: number, y: number): void => {
    if (isBg) pushBgTile(out, tid, x, y, gfx);
    else pushTile(out, tid, x, y, atlas);
  };

  const out: RenderedTile[] = [];
  switch (rawId) {
    case 9: case 10: case 11: case 28: case 29:
      emit(dim.topleft, posX, posY);
      emit(dim.bottomleft, posX, posY + 1);
      break;
    case 19:
      emit(dim.topleft, posX, posY);
      emit(dim.bottomleft, posX, posY + 1);
      emit(dim.top, posX + 1, posY);
      emit(dim.middle, posX + 1, posY + 1);
      emit(dim.bottomright, posX + 2, posY + 1);
      break;
    case 20:
      emit(dim.bottomleft, posX - 2, posY + 1);
      emit(dim.top, posX - 1, posY);
      emit(dim.middle, posX - 1, posY + 1);
      emit(dim.topright, posX, posY);
      emit(dim.bottomright, posX, posY + 1);
      break;
    case 21: case 30:
      pushTile(out, 0xfc, posX, posY, atlas); // desert entrance sentinel
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
    return renderEntrance(rom, rawId, world, item.tileX, item.tileY, atlas, gfx);
  }
  if (item.kind !== 'regular') return [];

  // ─── Regular item dispatch (mirrors DrawObjectEx switch) ────────
  switch (rawId) {
    case 6: case 7: case 8: case 12: case 13: case 15: case 22:
      return renderVertical(rom, rawId, world, item.tileX, item.tileY, false, isH, atlas, gfx);
    case 18:
      return renderVertical(rom, rawId, world, item.tileX, item.tileY, true, isH, atlas, gfx);
    case 0: case 1: case 2: case 3: case 4: case 5: case 17:
    case 32: case 33: case 34: case 35: case 36: case 37:
    case 38: case 39: case 40: case 41: case 42: case 43:
    case 44: case 45: case 46: case 47:
      return renderSingle(rom, rawId, world, item.tileX, item.tileY, atlas, gfx);
    case 24: case 25:
      return renderMassive(rom, rawId, world, item.tileX, item.tileY, atlas, gfx);
    case 14: case 16: case 23: case 30: case 31:
      return renderSpecialRegular(rom, rawId, world, item.tileX, item.tileY, atlas, gfx);
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
          return renderMassive(rom, rawId, world, item.tileX, item.tileY, atlas, gfx);
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
