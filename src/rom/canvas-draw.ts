/**
 * drawCanvas — port of `CLvlDraw::DrawCanvas` (clvldraw_canvas.cpp:335).
 *
 * Walks the grid once; for each visible cell, picks the atlas based on
 * `type !== 0` (BG strip, `gfx+10` in C++ bmTpl indexing) vs `type === 0`
 * (item atlas, `fx+4`). Invisible cells are skipped. For the item atlas
 * branch, tileId=0xFF is also skipped — that's the "no-render" sentinel
 * used by ITEM_DIM entries. For the BG atlas, 0xFF is a real tile index
 * (the last column of the 4096×16 strip) that the NES may render as a
 * solid-color tile (e.g., the "deep cave" black under a ground segment),
 * so we blit it like any other BG cell — mirroring C++ DrawGrGamma which
 * does not skip 0xFF.
 */

import type { CanvasGrid } from './canvas-grid';
import type { LevelPalette } from './palette-reader';
import {
  getColorizedAtlas, getColorizedBgAtlas,
  metatileRect, bgTileRect, METATILE_SIZE,
} from '@/assets/metatiles';

export function drawCanvas(
  ctx: CanvasRenderingContext2D,
  grid: CanvasGrid,
  palette: LevelPalette | null,
): void {
  if (!palette) return;

  const itemAtlas = getColorizedAtlas(grid.fx + 4, palette);
  const bgAtlas = getColorizedBgAtlas(grid.gfx, palette);

  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const cell = grid.getItem(cx, cy);
      if (!cell.visible) continue;

      if (cell.type !== 0) {
        if (!bgAtlas) continue;
        const { sx, sy } = bgTileRect(cell.tileId);
        ctx.drawImage(
          bgAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          cx * METATILE_SIZE, cy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
        );
      } else {
        if (!itemAtlas) continue;
        if (cell.tileId === 0xff) continue; // ITEM_DIM "no-render" sentinel
        const { sx, sy } = metatileRect(cell.tileId);
        ctx.drawImage(
          itemAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          cx * METATILE_SIZE, cy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
        );
      }
    }
  }
}

/**
 * Draw only cells where `ghost` differs from `base` — used to blit the
 * drag/resize preview at alpha over the already-rendered main grid.
 * The caller sets `ctx.globalAlpha` before calling. Cells where the
 * ghost placement was priority-rejected are identical to base and thus
 * skipped, which is what we want: the ghost shouldn't show where the
 * real placement wouldn't land either.
 */
export function drawCanvasDiff(
  ctx: CanvasRenderingContext2D,
  ghost: CanvasGrid,
  base: CanvasGrid,
  palette: LevelPalette | null,
): void {
  if (!palette) return;
  const itemAtlas = getColorizedAtlas(ghost.fx + 4, palette);
  const bgAtlas = getColorizedBgAtlas(ghost.gfx, palette);

  for (let cy = 0; cy < ghost.height; cy++) {
    for (let cx = 0; cx < ghost.width; cx++) {
      const g = ghost.getItem(cx, cy);
      const b = base.getItem(cx, cy);
      if (
        g.visible === b.visible &&
        g.tileId === b.tileId &&
        g.type === b.type
      ) continue;
      if (!g.visible) continue;

      if (g.type !== 0) {
        if (!bgAtlas) continue;
        const { sx, sy } = bgTileRect(g.tileId);
        ctx.drawImage(
          bgAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          cx * METATILE_SIZE, cy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
        );
      } else {
        if (!itemAtlas) continue;
        if (g.tileId === 0xff) continue;
        const { sx, sy } = metatileRect(g.tileId);
        ctx.drawImage(
          itemAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          cx * METATILE_SIZE, cy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
        );
      }
    }
  }
}
