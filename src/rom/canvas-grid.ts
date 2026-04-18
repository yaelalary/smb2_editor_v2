/**
 * CanvasGrid — port of the C++ tool's `m_Canvas.pItems[]` grid from
 * `clvldraw_canvas.cpp` (AllocCanvas, SetCanvasItem, SetCanvasNullItem,
 * GetCanvasItem).
 *
 * The grid owns every drawable cell of a level. `DrawGroundEx` and the
 * item renderers populate it via `setItem`; `drawCanvas` walks it once
 * and blits each cell to a 2D canvas context. This mirrors the C++ tool
 * verbatim — priority resolution happens at placement-time in setItem,
 * not as a post-sort on the item stream.
 *
 * CanvasCell mirrors NES_GITEM (clvldraw.h:41):
 *   - visible  ↔ fVisible
 *   - tileId   ↔ idTile
 *   - type     ↔ Item.Item.type   (low 2 bits = ground bitset, +4 = BG atlas)
 *   - regularId ↔ CONVERT_REGULAR(LevelItem(id).Regular()) for regulars (48-60 / <0x30)
 *   - groundType ↔ (LevelItem(id).Ground() >> 8) & 0x7 for ground cells
 *
 * The type field carries TWO orthogonal meanings:
 *   • For priority logic: `3 & type` — 0 = regular, 1/2/3 = ground bitset.
 *   • For atlas choice:   `type !== 0` → BG atlas (gfx+10); `type === 0` → item atlas (fx+4).
 * (See DrawCanvas clvldraw_canvas.cpp:351 — `if (type) DrawGrGamma else DrawGamma`.)
 */

import { PRIORITY_LIST, bgPrior } from './nesleveldef';

export interface CanvasCell {
  visible: boolean;
  tileId: number;
  type: number;
  regularId: number;
  groundType: number;
}

/** Zero-initialized cell, matches `ZeroMemory(&pItems[c], ...)` in C++. */
function emptyCell(): CanvasCell {
  return { visible: false, tileId: 0, type: 0, regularId: 0, groundType: 0 };
}

/** Readonly sentinel returned by `getItem` for out-of-bounds queries. */
const OOB_CELL: Readonly<CanvasCell> = Object.freeze({
  visible: false, tileId: 0, type: 0, regularId: 0, groundType: 0,
});

export class CanvasGrid {
  readonly width: number;
  readonly height: number;
  readonly fx: number;
  readonly gfx: number;
  readonly isH: boolean;

  private readonly cells: CanvasCell[];

  constructor(width: number, height: number, fx: number, gfx: number, isH: boolean) {
    this.width = width;
    this.height = height;
    this.fx = fx;
    this.gfx = gfx;
    this.isH = isH;
    this.cells = new Array<CanvasCell>(width * height);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = emptyCell();
  }

  /**
   * Read a cell. Out-of-bounds returns a frozen non-visible sentinel,
   * matching `GetCanvasItem` returning FALSE (caller sees no item).
   */
  getItem(x: number, y: number): Readonly<CanvasCell> {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return OOB_CELL;
    return this.cells[y * this.width + x]!;
  }

  /**
   * Clear a cell (mirrors SetCanvasNullItem clvldraw_canvas.cpp:257).
   * Out-of-bounds is a silent no-op — C++ returns FALSE, same observable effect.
   */
  setNullItem(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const c = this.cells[y * this.width + x]!;
    c.visible = false;
    c.tileId = 0;
    c.type = 0;
    c.regularId = 0;
    c.groundType = 0;
  }

  /**
   * Priority-aware placement, port of SetCanvasItem (clvldraw_canvas.cpp:146).
   * Returns true when the write happened, false when rejected. Writes only
   * when either:
   *   - the cell is empty, OR
   *   - none of the three priority cases rules against the new tile.
   *
   * Priority cases (mirroring lines 165, 168, 171 verbatim):
   *   1. existing regular (bg=0) + new ground (mybg!=0) + BG_PRIOR(existing.regular, mybg, fx, new.groundType, isH)
   *   2. existing ground  (bg!=0) + new regular (mybg=0) + BG_PRIOR(new.regular, bg, fx, existing.groundType, isH)
   *   3. both regular: existing.bPriority < new.bPriority → existing wins
   */
  setItem(x: number, y: number, cell: Omit<CanvasCell, 'visible'>): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    const idx = y * this.width + x;
    const c = this.cells[idx]!;

    if (c.visible) {
      const bg = c.type & 3;
      const mybg = cell.type & 3;

      if (!bg && mybg && bgPrior(c.regularId, mybg, this.fx, cell.groundType, this.isH)) {
        return false;
      }
      if (bg && !mybg && bgPrior(cell.regularId, bg, this.fx, c.groundType, this.isH)) {
        return false;
      }
      if (!bg && !mybg) {
        const existingP = PRIORITY_LIST[c.regularId]?.priority ?? 0;
        const newP = PRIORITY_LIST[cell.regularId]?.priority ?? 0;
        if (existingP < newP) return false;
      }
    }

    c.visible = true;
    c.tileId = cell.tileId;
    c.type = cell.type;
    c.regularId = cell.regularId;
    c.groundType = cell.groundType;
    return true;
  }

  /**
   * Unconditional write — bypasses priority check. For tests and for the
   * ground pass when we need to guarantee a cell is stamped (matches the
   * first-writer-wins behavior of ground over an empty cell).
   */
  forceSetItem(x: number, y: number, cell: Omit<CanvasCell, 'visible'>): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const c = this.cells[y * this.width + x]!;
    c.visible = true;
    c.tileId = cell.tileId;
    c.type = cell.type;
    c.regularId = cell.regularId;
    c.groundType = cell.groundType;
  }
}
