/**
 * Item renderer — writes every tile an item occupies into a CanvasGrid.
 *
 * Faithfully ports the C++ tool's Draw*ObjectEx dispatch from
 * `clvldraw_worker.cpp`. Each per-type helper computes tile IDs via
 * `Get*Dim` (ROM reads in tile-reader.ts), then calls
 * `grid.setItem(x, y, { tileId, type, regularId, groundType })` — the
 * grid's SetCanvasItem port handles priority rejection at placement.
 *
 * Atlas selection is no longer stored per-tile: the grid itself carries
 * `fx` and `gfx`, and `drawCanvas` (Unit 5) picks the atlas based on
 * `cell.type !== 0` (BG atlas `gfx+10`) vs `=== 0` (item atlas `fx+4`).
 *
 * This module is pure computation — no DOM, no canvas, no side effects
 * beyond the grid writes.
 */

import type { LevelItem, LevelHeader } from './model';
import type { NesItemDim } from './nesleveldef';
import { ITEM_DIM, convertRegular } from './nesleveldef';
import {
  getObjTile,
  getSingDim, getHorzDim, getVertDim, getMasvDim, getEntrDim,
  isSingBg, isVertBg, isMasvBg, isEntrBg,
} from './tile-reader';
import type { CanvasGrid } from './canvas-grid';

// ─── Internal helpers ──────────────────────────────────────────────

function emptyDim(): NesItemDim {
  return {
    topleft: 0xff, top: 0xff, topright: 0xff,
    left: 0xff, right: 0xff, middle: 0xff,
    bottomleft: 0xff, bottomright: 0xff,
  };
}

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
 * Write one tile through the grid's priority-aware setItem.
 * `type = 4` marks BG-atlas tiles (C++ `Item.Item.type = 4` set by
 * Get*Dim); the value is also used by SetCanvasItem's `3 & type`
 * ground-vs-regular check — since 4 & 3 === 0, BG-atlas items still
 * count as "regular" for the priority branches. That matches C++.
 */
function emit(
  grid: CanvasGrid,
  tileId: number,
  x: number, y: number,
  regularId: number,
  type: number,
): void {
  if (tileId === 0xff) return;
  grid.setItem(x, y, { tileId, type, regularId, groundType: 0 });
}

// ─── Per-type renderers ────────────────────────────────────────────

function renderSingle(
  grid: CanvasGrid, rom: Uint8Array, itemId: number, world: number,
  x: number, y: number, regularId: number,
): void {
  const dim = getSingDim(rom, itemId, world, fallbackDim(itemId));
  const type = isSingBg(itemId) ? 4 : 0;
  emit(grid, dim.topleft, x, y, regularId, type);
  // Big cloud (0x10) spans two tiles.
  if (itemId === 0x10) emit(grid, dim.topright, x + 1, y, regularId, type);
}

function renderHorizontal(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number,
  x: number, y: number, regularId: number,
): void {
  const id = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;
  const size = (rawId - 0x30) & 0x0f;
  const dim = getHorzDim(rom, id, world, fallbackDim(id));
  // GetHorzDim sets type=4 only for ids 0x0A/0x0B; fallback dim stays type=0.
  const type = id === 0x0a || id === 0x0b ? 4 : 0;
  emit(grid, dim.topleft, x, y, regularId, type);
  emit(grid, dim.topright, x + size, y, regularId, type);
  for (let i = 1; i < size; i++) {
    emit(grid, dim.middle, x + i, y, regularId, type);
  }
}

function renderVertical(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number,
  isInverted: boolean, isHorizontalLevel: boolean,
  regularId: number,
): void {
  let id: number;
  let size: number;
  if (rawId >= 0x30) {
    id = Math.floor((rawId - 0x30) / 0x10);
    size = rawId & 0x0f;
  } else {
    id = rawId;
    size = 0x0f * Math.floor((posY + 0x0f) / 0x0f) - posY - 1;
  }

  const dim = getVertDim(rom, id, world, fallbackDim(id));
  const type = isVertBg(id) ? 4 : 0;
  const isVine = id === 0x0c || id === 0x0d || id === 0x0f;

  // Vine stop check — mirrors DrawVertObjectEx `fIsVine && ng.fVisible &&
  // ng.idTile != 0x40 && ng.Item.Item.type`. We read the grid state live,
  // exactly like C++ `GetCanvasItem`.
  const isBlocked = (x: number, y: number): boolean => {
    const cell = grid.getItem(x, y);
    return cell.visible && cell.tileId !== 0x40 && cell.type !== 0;
  };

  if (!isInverted) {
    if (isVine) size += 0x0f;
    emit(grid, dim.topleft, posX, posY, regularId, type);
    for (let i = 1; i < size; i++) {
      if (isVine && isBlocked(posX, posY + i)) return;
      emit(grid, dim.middle, posX, posY + i, regularId, type);
    }
    if (size > 0 && (!isVine || !isBlocked(posX, posY + size))) {
      emit(grid, dim.bottomleft, posX, posY + size, regularId, type);
    }
  } else {
    emit(grid, dim.bottomleft, posX, posY, regularId, type);
    let minY = Math.max(posY - 0x0f, 0);
    if (id === 0x12 && !isHorizontalLevel && minY > 0) {
      minY = (1 + Math.floor(minY / 0x0f)) * 0x0f;
    }
    for (let cy = posY - 1; cy > minY; cy--) {
      emit(grid, dim.middle, posX, cy, regularId, type);
    }
    emit(grid, dim.topleft, posX, minY, regularId, type);
  }
}

function renderMassive(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number, regularId: number,
): void {
  const sizeX = rawId >= 0x30 ? ((rawId - 0x30) & 0x0f) : 5;
  const sizeY = 0x0e;
  const idRegular = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;
  const dim = getMasvDim(rom, idRegular, world, fallbackDim(idRegular));
  const type = isMasvBg(idRegular) ? 4 : 0;

  emit(grid, dim.topleft, posX, posY, regularId, type);
  emit(grid, dim.topright, posX + sizeX, posY, regularId, type);
  for (let cx = 1; cx < sizeX; cx++) {
    emit(grid, dim.top, posX + cx, posY, regularId, type);
  }
  for (let cy = 1; cy <= sizeY; cy++) {
    for (let cx = 0; cx <= sizeX; cx++) {
      const tid = cx === 0 ? dim.left : (cx < sizeX ? dim.middle : dim.right);
      emit(grid, tid, posX + cx, posY + cy, regularId, type);
    }
  }
}

function renderHorzGround(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number, objectType: number,
  posX: number, posY: number, regularId: number,
): void {
  const vid = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : rawId;
  const size = (rawId - 0x30) & 0x0f;
  const tileId = getObjTile(rom, vid, world, objectType);
  // DrawHorzGrObjectEx sets type=4 (BG atlas).
  for (let i = 0; i <= size; i++) {
    emit(grid, tileId, posX + i, posY, regularId, 4);
  }
}

function renderVertGround(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number, objectType: number,
  posX: number, posY: number, regularId: number,
): void {
  let vid: number;
  let size: number;
  if (rawId >= 0x30) {
    size = rawId & 0x0f;
    vid = Math.floor((rawId - 0x30) / 0x10);
  } else {
    vid = rawId;
    size = 0x0f * Math.floor((posY + 0x0f) / 0x0f) - posY;
  }
  const bodyTile = getObjTile(rom, vid, world, objectType);
  for (let i = 1; i <= size; i++) {
    emit(grid, bodyTile, posX, posY + i, regularId, 4);
  }
  // clvldraw_worker.cpp:417-419 — "except for 0x06 object. Up of this object has 0x9f tile!"
  const topTile = vid === 0x06 ? 0x9f : bodyTile;
  emit(grid, topTile, posX, posY, regularId, 4);
}

function renderSpecialRegular(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number, regularId: number,
): void {
  switch (rawId) {
    case 14: emit(grid, 0xfe, posX, posY, regularId, 0); break; // star bg sentinel
    case 16: {
      // Big cloud via GetSingDim → type=4.
      const dim = getSingDim(rom, rawId, world, fallbackDim(rawId));
      emit(grid, dim.topleft, posX, posY, regularId, 4);
      emit(grid, dim.topright, posX + 1, posY, regularId, 4);
      break;
    }
    case 23: renderPyramid(grid, posX, posY, regularId); break;
    case 30: emit(grid, 0xfc, posX, posY, regularId, 0); break; // desert-entrance sentinel
    case 31: renderLargeRedPlatformBg(grid, posX, posY, regularId); break;
  }
}

/**
 * Item 0x17 — "Pyramid".
 *
 * Faithful port of the ROM routine `CreateObject_Pyramid` in
 * Xkeeper0/smb2 src/prg-6-7.asm (dispatch via `CreateObjects_10` $17).
 * Symmetric triangle expanding downward:
 *   Row 0: `[LeftAngle, RightAngle]` (2 tiles, the apex)
 *   Row N: `[LeftAngle, N × LeftInner, N × RightInner, RightAngle]`
 *          starting at column `posX − N` (so the pyramid grows on
 *          both sides as it descends, 2N+2 tiles wide)
 * Same sky-gated descent as the red bg: each row's leftmost cell must
 * be sky for the routine to keep going.
 *
 * Tile IDs from src/defs.asm:
 *   LeftAngle=0x84, LeftInner=0x85, RightInner=0x86, RightAngle=0x87.
 *
 * forceSetItem mirrors raw nametable writes — earlier-stream items
 * inside the footprint are clobbered. Items emitted later land on top
 * via the normal priority-aware `setItem`.
 */
function renderPyramid(
  grid: CanvasGrid,
  posX: number, posY: number, regularId: number,
): void {
  const TILE_LEFT_ANGLE = 0x84;
  const TILE_LEFT_INNER = 0x85;
  const TILE_RIGHT_INNER = 0x86;
  const TILE_RIGHT_ANGLE = 0x87;
  const SKY = 0x40;

  const isBlocked = (x: number, y: number): boolean => {
    const cell = grid.getItem(x, y);
    if (!cell.visible) return false;
    return !(cell.type !== 0 && cell.tileId === SKY);
  };

  const put = (x: number, y: number, tileId: number) => {
    grid.forceSetItem(x, y, { tileId, type: 4, regularId, groundType: 0 });
  };

  for (let n = 0; n < grid.height; n++) {
    const leftCol = posX - n;
    const row = posY + n;
    if (row >= grid.height) return;
    if (isBlocked(leftCol, row)) return;
    put(leftCol, row, TILE_LEFT_ANGLE);
    for (let i = 0; i < n; i++) {
      put(leftCol + 1 + i, row, TILE_LEFT_INNER);
    }
    for (let i = 0; i < n; i++) {
      put(leftCol + 1 + n + i, row, TILE_RIGHT_INNER);
    }
    put(posX + n + 1, row, TILE_RIGHT_ANGLE);
  }
}

/**
 * Item 0x1F — "Large red platform background, extends to ground".
 *
 * Faithful port of the ROM routine `CreateObject_TreeBackground` in
 * Xkeeper0/smb2 src/prg-6-7.asm (dispatch via `CreateObjects_10` $1F).
 * Width is hardcoded to 12 tiles per row:
 *   `Left, [MidLeft, MidRight] × 5, Right`
 * Height is dynamic — the routine re-checks the leftmost cell of each
 * next row against `BackgroundTile_Sky` (0x40) and exits as soon as it
 * finds anything else. In our editor, ground cells are visible BG-atlas
 * cells with non-sky tile IDs, and unfilled sky regions are simply not
 * visible — both branches of "blocked" mirror the runtime check.
 *
 * Note: the very first row also gates on the placement cell being sky.
 * Placing this item on top of ground or another object renders nothing,
 * which is exactly what happens in-game.
 *
 * Tile IDs come from `defs.asm` in the disassembly:
 *   Left=0x5C, MidLeft=0x5D, MidRight=0x5F, Right=0x5E, Sky=0x40.
 *
 * The visible result depends on the world's CHR bank — vanilla SMB2 only
 * uses this item in W5-3 where it renders as red platforms, but the
 * routine itself is world-agnostic.
 */
function renderLargeRedPlatformBg(
  grid: CanvasGrid,
  posX: number, posY: number, regularId: number,
): void {
  const TILE_LEFT = 0x5c;
  const TILE_MID_LEFT = 0x5d;
  const TILE_MID_RIGHT = 0x5f;
  const TILE_RIGHT = 0x5e;
  const SKY = 0x40;

  const isBlocked = (x: number, y: number): boolean => {
    const cell = grid.getItem(x, y);
    if (!cell.visible) return false;
    return !(cell.type !== 0 && cell.tileId === SKY);
  };

  // Use forceSetItem (bypass priority) instead of the regular `emit` helper:
  // in-game this is just sequential nametable RAM writes, so anything in the
  // 12×N footprint that was placed earlier in the stream gets unconditionally
  // overwritten by the red-bg pattern. The C++ tool's priority list has us
  // tagged as background (priority 3), which would otherwise reject overwrites
  // of front-priority items (clouds, herbs) and leave them visible — but the
  // ROM does no such check. Items processed AFTER the red bg in stream order
  // still go through the normal `setItem` and correctly land on top, since
  // they'll have lower priority numbers than 3.
  const put = (x: number, y: number, tileId: number) => {
    grid.forceSetItem(x, y, { tileId, type: 4, regularId, groundType: 0 });
  };

  for (let y = posY; y < grid.height; y++) {
    if (isBlocked(posX, y)) return;
    put(posX, y, TILE_LEFT);
    for (let i = 0; i < 5; i++) {
      put(posX + 1 + i * 2, y, TILE_MID_LEFT);
      put(posX + 2 + i * 2, y, TILE_MID_RIGHT);
    }
    put(posX + 11, y, TILE_RIGHT);
  }
}

function renderEntrance(
  grid: CanvasGrid, rom: Uint8Array, rawId: number, world: number,
  posX: number, posY: number, regularId: number,
): void {
  const dim = getEntrDim(rom, rawId, world, fallbackDim(rawId));
  const type = isEntrBg(rawId) ? 4 : 0;

  switch (rawId) {
    case 9: case 10: case 11: case 28: case 29:
      emit(grid, dim.topleft, posX, posY, regularId, type);
      emit(grid, dim.bottomleft, posX, posY + 1, regularId, type);
      break;
    case 19:
      emit(grid, dim.topleft, posX, posY, regularId, type);
      emit(grid, dim.bottomleft, posX, posY + 1, regularId, type);
      emit(grid, dim.top, posX + 1, posY, regularId, type);
      emit(grid, dim.middle, posX + 1, posY + 1, regularId, type);
      emit(grid, dim.bottomright, posX + 2, posY + 1, regularId, type);
      break;
    case 20:
      emit(grid, dim.bottomleft, posX - 2, posY + 1, regularId, type);
      emit(grid, dim.top, posX - 1, posY, regularId, type);
      emit(grid, dim.middle, posX - 1, posY + 1, regularId, type);
      emit(grid, dim.topright, posX, posY, regularId, type);
      emit(grid, dim.bottomright, posX, posY + 1, regularId, type);
      break;
    case 21: case 30:
      emit(grid, 0xfc, posX, posY, regularId, 0); // desert-entrance sentinel
      break;
  }
}

// ─── Main dispatch ─────────────────────────────────────────────────

/**
 * Write every tile of a level item into the grid, mirroring the C++
 * DrawObjectEx dispatch. Each tile goes through `grid.setItem`, so
 * priority rejection happens at placement — no caller filtering needed.
 *
 * The `regularId` stored on each written cell is `CONVERT_REGULAR(item.itemId)`
 * so subsequent overlapping items resolve priority correctly.
 */
export function renderItem(
  grid: CanvasGrid,
  item: LevelItem,
  rom: Uint8Array,
  slot: number,
  header: LevelHeader,
): void {
  if (item.tileX < 0 || item.tileY < 0) return;

  const world = Math.floor(slot / 30);
  const isH = header.direction === 1;
  const rawId = item.itemId;
  const objType = header.objectType & 0x0f;
  const regularId = convertRegular(rawId);

  if (item.kind === 'entrance') {
    renderEntrance(grid, rom, rawId, world, item.tileX, item.tileY, regularId);
    return;
  }
  if (item.kind !== 'regular') return;

  switch (rawId) {
    case 6: case 7: case 8: case 12: case 13: case 15: case 22:
      renderVertical(grid, rom, rawId, world, item.tileX, item.tileY, false, isH, regularId);
      return;
    case 18:
      renderVertical(grid, rom, rawId, world, item.tileX, item.tileY, true, isH, regularId);
      return;
    case 0: case 1: case 2: case 3: case 4: case 5: case 17:
    case 32: case 33: case 34: case 35: case 36: case 37:
    case 38: case 39: case 40: case 41: case 42: case 43:
    case 44: case 45: case 46: case 47:
      renderSingle(grid, rom, rawId, world, item.tileX, item.tileY, regularId);
      return;
    case 24: case 25:
      renderMassive(grid, rom, rawId, world, item.tileX, item.tileY, regularId);
      return;
    case 14: case 16: case 23: case 30: case 31:
      renderSpecialRegular(grid, rom, rawId, world, item.tileX, item.tileY, regularId);
      return;
    default: {
      if (rawId < 0x30) return;
      const vid = Math.floor((rawId - 0x30) / 0x10);
      switch (vid) {
        case 0: case 1: case 2: case 3: case 4:
          renderHorzGround(grid, rom, rawId, world, objType, item.tileX, item.tileY, regularId);
          return;
        case 5: case 6: case 7:
          renderVertGround(grid, rom, rawId, world, objType, item.tileX, item.tileY, regularId);
          return;
        case 10: case 11:
          renderHorizontal(grid, rom, rawId, world, item.tileX, item.tileY, regularId);
          return;
        case 8: case 9: case 12:
          renderMassive(grid, rom, rawId, world, item.tileX, item.tileY, regularId);
          return;
      }
    }
  }
}
