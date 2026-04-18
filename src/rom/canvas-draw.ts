/**
 * drawCanvas — port of `CLvlDraw::DrawCanvas` (clvldraw_canvas.cpp:335).
 *
 * Walks the grid once; for each visible cell, picks the atlas based on
 * `type !== 0` (BG strip, `gfx+10` in C++ bmTpl indexing) vs `type === 0`
 * (item atlas, `fx+4`). Invisible cells and cells with tileId=0xFF are
 * skipped — the initial bgColor fill shows through, matching the C++
 * behavior where magenta atlas pixels reveal the palette bg.
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

  // Atlases are shared across the whole pass — look up once.
  const itemAtlas = getColorizedAtlas(grid.fx + 4, palette);
  const bgAtlas = getColorizedBgAtlas(grid.gfx, palette);

  for (let cy = 0; cy < grid.height; cy++) {
    for (let cx = 0; cx < grid.width; cx++) {
      const cell = grid.getItem(cx, cy);
      if (!cell.visible) continue;
      if (cell.tileId === 0xff) continue; // invisible-solid sentinel

      if (cell.type !== 0) {
        if (!bgAtlas) continue;
        const { sx, sy } = bgTileRect(cell.tileId);
        ctx.drawImage(
          bgAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          cx * METATILE_SIZE, cy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
        );
      } else {
        if (!itemAtlas) continue;
        const { sx, sy } = metatileRect(cell.tileId);
        ctx.drawImage(
          itemAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          cx * METATILE_SIZE, cy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
        );
      }
    }
  }
}
