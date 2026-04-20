<script setup lang="ts">
/**
 * Interactive level canvas — Unit 6 (view) + Unit 10 (editing).
 *
 * Renders the active level + handles:
 *   - Drop from TileLibrary → PlaceTileCommand
 *   - Click → select item
 *   - Delete/Backspace → DeleteItemCommand
 *   - Drag selected item → MoveItemCommand
 */
import { ref, shallowRef, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { levelDimensions, getFxForSlot } from '@/rom/level-layout';
import { readLevelPalette } from '@/rom/palette-reader';
import type { LevelBlock, LevelItem, EnemyBlock, EnemyItem } from '@/rom/model';
import { ENEMY_DIM } from '@/rom/nesleveldef';
import { getWorldGfx } from '@/rom/tile-reader';
import { DRAG_MIME, ENEMY_DRAG_MIME } from '@/rom/item-categories';
import { PlaceTileCommand, DeleteItemCommand, MoveItemCommand, DeleteItemsCommand, MoveItemsCommand, ResizeItemCommand, libraryIdToRomByte } from '@/commands/tile-commands';
import { ENTRANCE_ITEM_IDS } from '@/rom/constants';
import { PlaceEnemyCommand, DeleteEnemyCommand, MoveEnemyCommand, DeleteEnemiesCommand, MoveEnemiesCommand } from '@/commands/enemy-commands';
import { MoveGroundSegmentCommand } from '@/commands/ground-commands';
import { drawHerbOverlay, enemyAtlasForLevel, hasHerbOverlay, preloadHerbOverlays } from '@/ui/herb-overlays';
import { isResizable, handlePosition, sizeFromHover, withSize, resizeAxis } from '@/rom/item-resize';
import { activeDrag } from '@/ui/drag-state';
import { renderItem } from '@/rom/item-renderer';
import { CanvasGrid } from '@/rom/canvas-grid';
import { computeGroundSegments, groundPass } from '@/rom/ground-pass';
import { drawCanvas, drawCanvasDiff } from '@/rom/canvas-draw';
import {
  getAtlasImage,
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';

const TILE_PX = 16;

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
// shallowRef — see comment on `selectedEnemies` below. Same reasoning:
// ref() deep-proxies stored items, breaking reference identity against
// the raw items iterated in draw and in command `indexOf()` lookups.
// Without this, DeleteItemCommand.execute silently no-ops because
// `this.block.items.indexOf(this.item)` returns -1.
const selectedItems = shallowRef<LevelItem[]>([]);
/**
 * Enemy selection mirrors `selectedItems` — multi-select via shift/ctrl
 * or rubber-band. Each entry carries its `pageIndex` because enemy
 * bytes encode page-local coordinates and the page is direction-
 * dependent. Selection uses REFERENCE equality on `enemy` — group
 * moves mutate `enemy.x/y`, so coordinate-keyed lookups break.
 */
type EnemySelection = { enemy: EnemyItem; pageIndex: number };
// shallowRef — critical: `ref()` would recursively wrap stored enemies
// with reactive proxies, breaking reference identity against the raw
// enemy objects we iterate over in the draw loop. The `Set.has()` call
// in the selection-ring pass relies on that identity. shallowRef keeps
// the array's top-level mutation reactive but leaves items untouched.
const selectedEnemies = shallowRef<EnemySelection[]>([]);

// Ghost position for drop preview.
const ghostTile = ref<{ x: number; y: number } | null>(null);

// Drag preview — when dragging selected items, render a semi-transparent
// copy at the current hover tile so the user sees the landing position
// before releasing. `dx/dy` is the delta from each item's original anchor.
const dragPreview = ref<{ dx: number; dy: number } | null>(null);

// Resize state — active when the user grabbed a resize handle. Holds
// the item being resized and the size we would commit on release.
const resizePreview = ref<{ item: LevelItem; newSize: number } | null>(null);

// Enemy drag preview — mirror of dragPreview but for the selected
// enemy in enemy mode. Carries the (dx, dy) delta so the ghost renders
// at the offset position while the mouse is held.
const enemyDragPreview = ref<{ dx: number; dy: number } | null>(null);

// Cursor style for the canvas — switches to `ew-resize` / `ns-resize`
// when hovering a selected item's resize handle so the affordance is
// immediately readable.
const hoverCursor = ref<'default' | 'ew-resize' | 'ns-resize'>('default');

// Rubber-band selection rectangle (tile coordinates).
const rubberBand = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

// Hit-rects (CSS px) for the "Zone N" chips, rebuilt each draw. Drives
// mousedown detection for drag-to-resize on a zone boundary.
type ChipRect = { item: LevelItem; x: number; y: number; w: number; h: number };
let chipRects: ChipRect[] = [];

// Zone-chip drag state. `previewPos` is the clamped tile position the
// boundary will snap to on mouseup. A ghost line is rendered at this
// position during drag — no live ground reflow.
const groundResizeDrag = ref<{ item: LevelItem; previewPos: number } | null>(null);

const block = computed<LevelBlock | null>(() => {
  void history.revision;
  const b = rom.activeBlock;
  return b ? (b as LevelBlock) : null;
});

// ─── Coordinate helpers ─────────────────────────────────────────────

function tileFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / TILE_PX);
  const y = Math.floor((e.clientY - rect.top) / TILE_PX);
  return { x, y };
}

/** Raw CSS-pixel cursor position inside the canvas (null if offscreen). */
function cssFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** Zone-chip hit test against `chipRects` rebuilt each draw. */
function hitTestChip(cssX: number, cssY: number): ChipRect | null {
  for (const cr of chipRects) {
    if (cssX >= cr.x && cssX < cr.x + cr.w && cssY >= cr.y && cssY < cr.y + cr.h) return cr;
  }
  return null;
}

/**
 * Clamp a wanted start-pos for a ground segment to `[prev+1, next-1]` so
 * both neighbour zones stay at least 1 tile wide. Matches `clampStart`
 * in GroundPanel.vue.
 */
function clampGroundStart(item: LevelItem, wanted: number): number {
  const b = block.value;
  if (!b) return Math.floor(wanted);
  const stream = b.items.filter((it) => it.kind === 'groundSet');
  const idx = stream.indexOf(item);
  if (idx < 0) return Math.floor(wanted);
  const isH = b.header.direction === 1;
  const { widthTiles, heightTiles } = levelDimensions(b);
  const axisLen = isH ? widthTiles : heightTiles;
  const prev = idx > 0 ? stream[idx - 1]! : null;
  const next = idx < stream.length - 1 ? stream[idx + 1]! : null;
  const min = (prev?.absoluteStartPos ?? 0) + 1;
  const max = next ? (next.absoluteStartPos ?? axisLen) - 1 : axisLen - 1;
  return Math.min(Math.max(Math.round(wanted), min), max);
}

function hitTestTile(tileX: number, tileY: number): LevelItem | null {
  const b = block.value;
  if (!b) return null;
  for (const item of b.items) {
    if (item.tileX === tileX && item.tileY === tileY) return item;
  }
  return null;
}

/**
 * Absolute tile rect occupied by an enemy. Mirrors C++
 * cneseditor_loader.cpp:119-129 position transform + multi-tile
 * footprint from ENEMY_DIM (masking bit 7 per CNesItem::Enemy()
 * `id & 0x7f`). Shared by hit-test, drag-hit, rubber-band, and draw.
 */
function enemyFootprint(
  enemy: EnemyItem,
  pageIndex: number,
  isH: boolean,
): { absX: number; absY: number; cx: number; cy: number } {
  const absX = isH ? pageIndex * 16 + enemy.x : enemy.x;
  const absY = isH ? enemy.y : pageIndex * 16 + enemy.y;
  const szxy = ENEMY_DIM[enemy.id & 0x7f]?.[1] ?? 0xff;
  const cx = szxy === 0xff ? 1 : Math.max(1, szxy & 0x0f);
  const cy = szxy === 0xff ? 1 : Math.max(1, (szxy >> 4) & 0x0f);
  return { absX, absY, cx, cy };
}

function hitTestEnemy(tileX: number, tileY: number): EnemySelection | null {
  const eb = getEnemyBlock();
  if (!eb) return null;
  const isH = block.value?.header.direction === 1;
  for (let pageIdx = 0; pageIdx < eb.pages.length; pageIdx++) {
    const page = eb.pages[pageIdx]!;
    for (const enemy of page.enemies) {
      const { absX, absY, cx, cy } = enemyFootprint(enemy, pageIdx, !!isH);
      if (tileX >= absX && tileX < absX + cx && tileY >= absY && tileY < absY + cy) {
        return { enemy, pageIndex: pageIdx };
      }
    }
  }
  return null;
}

/** True when (tileX, tileY) falls inside any selected enemy's footprint. */
function isInsideAnySelectedEnemy(tileX: number, tileY: number): boolean {
  const isH = block.value?.header.direction === 1;
  for (const sel of selectedEnemies.value) {
    const { absX, absY, cx, cy } = enemyFootprint(sel.enemy, sel.pageIndex, !!isH);
    if (tileX >= absX && tileX < absX + cx && tileY >= absY && tileY < absY + cy) {
      return true;
    }
  }
  return false;
}

function getEnemyBlock(): EnemyBlock | null {
  // `activeEnemyBlock` reads through the store's inner shallowRef (not
  // the readonly wrapper exposed on the store surface), so mutations
  // from commands propagate. Using `rom.enemyMap` directly would give a
  // DeepReadonly object and silently drop writes.
  return (rom.activeEnemyBlock as EnemyBlock) ?? null;
}

// ─── Drop from TileLibrary or EnemyLibrary ──────────────────────────

function onDragOver(e: DragEvent): void {
  const types = e.dataTransfer?.types;
  const accept =
    types?.includes(DRAG_MIME) ||
    types?.includes(ENEMY_DRAG_MIME);
  if (!accept) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
  const tile = tileFromEvent(e);
  ghostTile.value = tile;
  redraw();
}

function onDragLeave(): void {
  ghostTile.value = null;
  redraw();
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  ghostTile.value = null;
  activeDrag.value = null;
  if (!e.dataTransfer) return;

  const tile = tileFromEvent(e);
  if (!tile) return;

  // Enemy drop?
  const enemyRaw = e.dataTransfer.getData(ENEMY_DRAG_MIME);
  if (enemyRaw) {
    const eb = getEnemyBlock();
    if (!eb) return;
    try {
      const payload = JSON.parse(enemyRaw) as { enemyId: number };
      // Direction-aware page split: horizontal pages stack by X, vertical by Y.
      const isH = block.value?.header.direction === 1;
      const pageIndex = isH ? Math.floor(tile.x / 16) : Math.floor(tile.y / 16);
      const localX = isH ? tile.x % 16 : tile.x;
      const localY = isH ? tile.y : tile.y % 16;
      history.execute(
        new PlaceEnemyCommand(eb, pageIndex, localX, localY, payload.enemyId, rom.activeSlot),
      );
    } catch { /* ignore bad payload */ }
    redraw();
    return;
  }

  // Tile drop.
  const tileRaw = e.dataTransfer.getData(DRAG_MIME);
  if (tileRaw) {
    const b = block.value;
    if (!b) return;
    try {
      const payload = JSON.parse(tileRaw) as { itemId: number };
      history.execute(
        new PlaceTileCommand(b, tile.x, tile.y, payload.itemId, rom.activeSlot),
      );
    } catch { /* ignore bad payload */ }
    redraw();
  }
}

// ─── Click, drag-to-move, and rubber-band multi-select ─────────────

let mouseDownPos: { x: number; y: number } | null = null;
let isDraggingSelection = false;
// Non-null while the user is dragging a resize handle. We don't re-use
// mouseDownPos-based detection because handles sit just outside the
// item's selection ring and require their own dispatch.
let resizeTarget: LevelItem | null = null;

/** Find a selected extended item whose handle sits at (x, y), if any. */
function hitTestHandle(tileX: number, tileY: number): LevelItem | null {
  for (const item of selectedItems.value) {
    if (!isResizable(item.itemId)) continue;
    const h = handlePosition(item);
    if (h.x === tileX && h.y === tileY) return item;
  }
  return null;
}

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  mouseDownPos = tileFromEvent(e);
  isDraggingSelection = false;
  rubberBand.value = null;

  // Ground mode: grabbing a "Zone N" chip starts a drag-to-resize. The
  // ghost line renders at `previewPos` during drag — real commit on release.
  if (editor.activeTool === 'ground') {
    const css = cssFromEvent(e);
    const chip = css ? hitTestChip(css.x, css.y) : null;
    if (chip) {
      editor.selectedGroundSegment = chip.item;
      groundResizeDrag.value = {
        item: chip.item,
        previewPos: chip.item.absoluteStartPos ?? 0,
      };
      redraw();
      return;
    }
  }

  // Resize-handle grab takes precedence over body click (a handle can
  // overlap neighbouring tiles and we want the drag to be resize, not
  // a move from the handle's cell).
  if (mouseDownPos && editor.activeTool === 'tiles') {
    const hit = hitTestHandle(mouseDownPos.x, mouseDownPos.y);
    if (hit) {
      resizeTarget = hit;
      resizePreview.value = { item: hit, newSize: hit.itemId & 0x0f };
    }
  }
}

function onMouseMove(e: MouseEvent): void {
  const pos = tileFromEvent(e);

  // Hover affordance for resize handles (no button pressed).
  if (e.buttons === 0 && pos && editor.activeTool === 'tiles') {
    const hover = hitTestHandle(pos.x, pos.y);
    const next: typeof hoverCursor.value = hover
      ? resizeAxis(hover.itemId) === 'vertical' ? 'ns-resize' : 'ew-resize'
      : 'default';
    if (hoverCursor.value !== next) hoverCursor.value = next;
  }

  // Hover affordance for ground chips (no button pressed).
  if (e.buttons === 0 && editor.activeTool === 'ground') {
    const css = cssFromEvent(e);
    const chip = css ? hitTestChip(css.x, css.y) : null;
    const isH = block.value?.header.direction === 1;
    const next: typeof hoverCursor.value = chip ? (isH ? 'ew-resize' : 'ns-resize') : 'default';
    if (hoverCursor.value !== next) hoverCursor.value = next;
  }

  if (!mouseDownPos || e.buttons !== 1) return;
  if (!pos) return;

  // Ground mode: either a chip drag (resize a zone) or no-op. The ghost
  // line + fill band follow `previewPos` — no live ground reflow.
  if (editor.activeTool === 'ground') {
    const drag = groundResizeDrag.value;
    if (!drag) return;
    const css = cssFromEvent(e);
    if (!css) return;
    const isH = block.value?.header.direction === 1;
    const cursorCss = isH ? css.x : css.y;
    const clamped = clampGroundStart(drag.item, cursorCss / TILE_PX);
    if (clamped !== drag.previewPos) {
      groundResizeDrag.value = { item: drag.item, previewPos: clamped };
      redraw();
    }
    return;
  }

  // Enemy mode: group-drag if mouseDown was inside any selected enemy's
  // footprint; otherwise fall through to rubber-band.
  if (editor.activeTool === 'enemies') {
    if (isInsideAnySelectedEnemy(mouseDownPos.x, mouseDownPos.y)) {
      const dx = pos.x - mouseDownPos.x;
      const dy = pos.y - mouseDownPos.y;
      if (
        !enemyDragPreview.value ||
        enemyDragPreview.value.dx !== dx ||
        enemyDragPreview.value.dy !== dy
      ) {
        enemyDragPreview.value = { dx, dy };
        redraw();
      }
      return;
    }
    // Fall through to rubber-band block below.
  } else {
    // Tile mode: resize handle or group move.
    if (resizeTarget) {
      const newSize = sizeFromHover(resizeTarget, pos.x, pos.y);
      if (!resizePreview.value || resizePreview.value.newSize !== newSize) {
        resizePreview.value = { item: resizeTarget, newSize };
        redraw();
      }
      return;
    }

    if (selectedItems.value.some((it) => it.tileX === mouseDownPos!.x && it.tileY === mouseDownPos!.y)) {
      const dx = pos.x - mouseDownPos.x;
      const dy = pos.y - mouseDownPos.y;
      if (!dragPreview.value || dragPreview.value.dx !== dx || dragPreview.value.dy !== dy) {
        dragPreview.value = { dx, dy };
        redraw();
      }
      return;
    }
  }

  // Rubber-band: drag from empty space (tile OR enemy mode).
  isDraggingSelection = true;
  rubberBand.value = {
    x1: Math.min(mouseDownPos.x, pos.x),
    y1: Math.min(mouseDownPos.y, pos.y),
    x2: Math.max(mouseDownPos.x, pos.x),
    y2: Math.max(mouseDownPos.y, pos.y),
  };
  redraw();
}

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 0) return;
  const upPos = tileFromEvent(e);
  if (!upPos || !mouseDownPos) {
    mouseDownPos = null;
    rubberBand.value = null;
    return;
  }

  const moved = upPos.x !== mouseDownPos.x || upPos.y !== mouseDownPos.y;

  // ─── Ground mode: chip-drag release OR click-to-select body ────
  if (editor.activeTool === 'ground') {
    const b = block.value;
    const drag = groundResizeDrag.value;
    if (b && drag) {
      const oldPos = drag.item.absoluteStartPos ?? 0;
      if (drag.previewPos !== oldPos) {
        history.execute(new MoveGroundSegmentCommand(b, drag.item, drag.previewPos, rom.activeSlot));
      }
      groundResizeDrag.value = null;
    } else if (b) {
      const isH = b.header.direction === 1;
      const clickPos = isH ? upPos.x : upPos.y;
      const groundStream = b.items.filter((it) => it.kind === 'groundSet');
      // Walk stream groundSets — the last one whose startPos ≤ clickPos wins.
      // If none matches, the header segment (startPos=0) covers this tile.
      let hit: LevelItem | null = null;
      for (const gi of groundStream) {
        if ((gi.absoluteStartPos ?? 0) <= clickPos) hit = gi;
      }
      editor.selectedGroundSegment = hit ?? 'header';
    }
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Tile mode: resize-handle release ──────────────────────────
  if (resizeTarget && resizePreview.value) {
    const target = resizeTarget;
    const newSize = resizePreview.value.newSize;
    const b = block.value;
    if (b && newSize !== (target.itemId & 0x0f)) {
      history.execute(
        new ResizeItemCommand(b, target, newSize, rom.activeSlot),
      );
    }
    resizeTarget = null;
    resizePreview.value = null;
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Enemy mode ────────────────────────────────────────────────
  if (editor.activeTool === 'enemies') {
    const isH = block.value?.header.direction === 1;

    // Group drag-to-move release: commit if any non-zero offset and
    // mouseDown landed inside a selected footprint.
    const edp = enemyDragPreview.value;
    if (edp && (edp.dx !== 0 || edp.dy !== 0) && selectedEnemies.value.length > 0) {
      const eb = getEnemyBlock();
      if (eb) {
        if (selectedEnemies.value.length === 1) {
          const sel = selectedEnemies.value[0]!;
          const oldAbsX = isH ? sel.pageIndex * 16 + sel.enemy.x : sel.enemy.x;
          const oldAbsY = isH ? sel.enemy.y : sel.pageIndex * 16 + sel.enemy.y;
          const newAbsX = oldAbsX + edp.dx;
          const newAbsY = oldAbsY + edp.dy;
          if (newAbsX >= 0 && newAbsY >= 0) {
            const newPageIndex = isH ? Math.floor(newAbsX / 16) : Math.floor(newAbsY / 16);
            const newLocalX = isH ? newAbsX % 16 : newAbsX;
            const newLocalY = isH ? newAbsY : newAbsY % 16;
            history.execute(
              new MoveEnemyCommand(
                eb, sel.enemy, sel.pageIndex,
                newPageIndex, newLocalX, newLocalY,
                rom.activeSlot,
              ),
            );
            selectedEnemies.value = [{ enemy: sel.enemy, pageIndex: newPageIndex }];
          }
        } else {
          const cmd = new MoveEnemiesCommand(
            eb, selectedEnemies.value, edp.dx, edp.dy, !!isH, rom.activeSlot,
          );
          if (!cmd.wasRejected) {
            history.execute(cmd);
            selectedEnemies.value = selectedEnemies.value.map((s, i) => ({
              enemy: s.enemy,
              pageIndex: cmd.getNewPage(i),
            }));
          }
        }
      }
      enemyDragPreview.value = null;
      mouseDownPos = null;
      redraw();
      return;
    }

    // Rubber-band release: select every enemy whose footprint intersects rb.
    if (isDraggingSelection && rubberBand.value) {
      const rb = rubberBand.value;
      const eb = getEnemyBlock();
      const hits: EnemySelection[] = [];
      if (eb) {
        for (let pageIdx = 0; pageIdx < eb.pages.length; pageIdx++) {
          for (const enemy of eb.pages[pageIdx]!.enemies) {
            const { absX, absY, cx, cy } = enemyFootprint(enemy, pageIdx, !!isH);
            const overlaps =
              absX + cx - 1 >= rb.x1 && absX <= rb.x2 &&
              absY + cy - 1 >= rb.y1 && absY <= rb.y2;
            if (overlaps) hits.push({ enemy, pageIndex: pageIdx });
          }
        }
      }
      selectedEnemies.value = hits;
      selectedItems.value = [];
      rubberBand.value = null;
      isDraggingSelection = false;
      enemyDragPreview.value = null;
      mouseDownPos = null;
      redraw();
      return;
    }

    // Click-to-select (with shift/ctrl modifiers).
    const hitE = hitTestEnemy(upPos.x, upPos.y);
    if (e.shiftKey && hitE) {
      if (!selectedEnemies.value.some((s) => s.enemy === hitE.enemy)) {
        selectedEnemies.value = [...selectedEnemies.value, hitE];
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (hitE) {
        const idx = selectedEnemies.value.findIndex((s) => s.enemy === hitE.enemy);
        if (idx !== -1) {
          selectedEnemies.value = selectedEnemies.value.filter((_, i) => i !== idx);
        } else {
          selectedEnemies.value = [...selectedEnemies.value, hitE];
        }
      }
    } else {
      selectedEnemies.value = hitE ? [hitE] : [];
    }
    selectedItems.value = [];
    enemyDragPreview.value = null;
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Tile mode: rubber-band release → select items in rect ─────
  if (isDraggingSelection && rubberBand.value) {
    const rb = rubberBand.value;
    const b = block.value;
    if (b) {
      const hits = b.items.filter(
        (it) => it.tileX >= 0 && it.tileY >= 0 &&
          it.tileX >= rb.x1 && it.tileX <= rb.x2 &&
          it.tileY >= rb.y1 && it.tileY <= rb.y2,
      );
      selectedItems.value = hits;
    }
    selectedEnemies.value = [];
    rubberBand.value = null;
    isDraggingSelection = false;
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Tile mode: group move (drag selected items) ───────────────
  if (
    selectedItems.value.length > 0 &&
    moved &&
    selectedItems.value.some((it) => it.tileX === mouseDownPos!.x && it.tileY === mouseDownPos!.y)
  ) {
    const b = block.value;
    if (b) {
      const dx = upPos.x - mouseDownPos.x;
      const dy = upPos.y - mouseDownPos.y;
      if (selectedItems.value.length === 1) {
        history.execute(
          new MoveItemCommand(b, selectedItems.value[0]!, upPos.x, upPos.y, rom.activeSlot),
        );
      } else {
        history.execute(
          new MoveItemsCommand(b, selectedItems.value, dx, dy, rom.activeSlot),
        );
      }
    }
    dragPreview.value = null;
    mouseDownPos = null;
    redraw();
    return;
  }

  // If we were showing a drag preview but ended on the same tile (no move),
  // still clear it on release.
  dragPreview.value = null;

  // ─── Tile mode: click to select/toggle ─────────────────────────
  const hit = hitTestTile(upPos.x, upPos.y);
  if (e.shiftKey && hit) {
    // Shift+click: add to selection
    if (!selectedItems.value.includes(hit)) {
      selectedItems.value = [...selectedItems.value, hit];
    }
  } else if (e.ctrlKey || e.metaKey) {
    // Ctrl+click: toggle individual
    if (hit) {
      const idx = selectedItems.value.indexOf(hit);
      if (idx !== -1) {
        selectedItems.value = selectedItems.value.filter((_, i) => i !== idx);
      } else {
        selectedItems.value = [...selectedItems.value, hit];
      }
    }
  } else {
    // Plain click: single select
    selectedItems.value = hit ? [hit] : [];
  }
  selectedEnemies.value = [];
  mouseDownPos = null;
  redraw();
}

// ─── Delete key ─────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();

    // Delete selected enemies (single or multi).
    const enemies = selectedEnemies.value;
    if (enemies.length > 0) {
      const eb = getEnemyBlock();
      if (eb) {
        if (enemies.length === 1) {
          const sel = enemies[0]!;
          history.execute(
            new DeleteEnemyCommand(eb, sel.pageIndex, sel.enemy, rom.activeSlot),
          );
        } else {
          history.execute(new DeleteEnemiesCommand(eb, enemies, rom.activeSlot));
        }
        selectedEnemies.value = [];
        redraw();
      }
      return;
    }

    // Delete selected tile items (single or multi)?
    const items = selectedItems.value;
    const b = block.value;
    if (items.length > 0 && b) {
      if (items.length === 1) {
        history.execute(new DeleteItemCommand(b, items[0]!, rom.activeSlot));
      } else {
        history.execute(new DeleteItemsCommand(b, items, rom.activeSlot));
      }
      selectedItems.value = [];
      redraw();
    }
  }
}

// ─── Drawing ────────────────────────────────────────────────────────
//
// Mirrors C++ DrawLevelEx (clvldraw_worker.cpp:5) verbatim:
//   1. AllocCanvas(widthTiles, heightTiles, fx)   → CanvasGrid
//   2. ground pass (DrawGroundEx for each segment) → groundPass()
//   3. item pass in stream order (DrawObjectEx)   → renderItem() per item
//   4. DrawCanvas (atlas per cell.type)           → drawCanvas()
// The priority rejection lives in grid.setItem (SetCanvasItem port), so
// there is no post-sort, no ground-occupancy pre-pass, no transparency
// eraser. The initial bgColor fill is what magenta-transparent atlas
// pixels reveal in the final blit.

function draw(canvas: HTMLCanvasElement, b: LevelBlock): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const { widthTiles, heightTiles } = levelDimensions(b);
  const cssW = widthTiles * TILE_PX;
  const cssH = heightTiles * TILE_PX;

  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const romData = rom.romData;
  const palette = romData
    ? readLevelPalette(romData.rom, rom.activeSlot, b.header.palette)
    : null;
  ctx.fillStyle = palette?.bgColorCss ?? '#1a1a2e';
  ctx.fillRect(0, 0, cssW, cssH);

  // Subtle grid lines (work on any bg).
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= widthTiles; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_PX, 0);
    ctx.lineTo(x * TILE_PX, cssH);
    ctx.stroke();
  }
  for (let y = 0; y <= heightTiles; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_PX);
    ctx.lineTo(cssW, y * TILE_PX);
    ctx.stroke();
  }

  // Page separators.
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  if (b.header.direction === 1) {
    for (let p = 1; p <= b.header.length; p++) {
      const px = p * 16 * TILE_PX;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssH);
      ctx.stroke();
    }
  } else {
    for (let p = 1; p <= b.header.length; p++) {
      const py = p * 15 * TILE_PX;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(cssW, py);
      ctx.stroke();
    }
  }

  // ─── Canvas grid pipeline (C++ DrawLevelEx port) ────────────────
  if (romData) {
    const isH = b.header.direction === 1;
    const world = Math.floor(rom.activeSlot / 30);
    const fx = getFxForSlot(rom.activeSlot);
    const gfx = getWorldGfx(romData.rom, world);

    // Preview state gates: when a drag or resize is active, we exclude
    // the affected items from the MAIN render and show them only as a
    // ghost overlay at their new pos/size. Previously we left the
    // original solid AND drew the ghost — that looked like duplication,
    // especially on tall items like vines.
    const dp = dragPreview.value;
    const rp = resizePreview.value;
    const dragActive = dp && (dp.dx !== 0 || dp.dy !== 0);
    const resizeActive = rp && rp.newSize !== (rp.item.itemId & 0x0f);
    const excluded = new Set<LevelItem>();
    if (dragActive) for (const it of selectedItems.value) excluded.add(it);
    if (resizeActive) excluded.add(rp.item);

    const grid = new CanvasGrid(widthTiles, heightTiles, fx, gfx, isH);
    const segments = computeGroundSegments(b);
    groundPass(grid, romData.rom, world, segments);
    for (const item of b.items) {
      if (excluded.has(item)) continue;
      renderItem(grid, item, romData.rom, rom.activeSlot, b.header);
    }
    drawCanvas(ctx, grid, palette);

    // ── Herb content badges ──────────────────────────────────────
    // Editor-only: each "Herb with X" item (ids 32..42, 43, 45) gets a
    // small enemy-atlas sprite painted above its tile showing what pops
    // out on pull. Nothing changes in the ROM; purely a visual aid.
    const herbEnemyAtlas = enemyAtlasForLevel(b.header.enemyColor);
    for (const item of b.items) {
      if (item.kind !== 'regular') continue;
      if (item.tileX < 0 || item.tileY < 0) continue;
      if (excluded.has(item)) continue;
      if (!hasHerbOverlay(item.itemId)) continue;
      drawHerbOverlay(ctx, item.tileX * TILE_PX, item.tileY * TILE_PX, TILE_PX, item.itemId, herbEnemyAtlas);
    }

    // ── Ground mode overlay ──────────────────────────────────────
    // When the Ground tool is active, draw a faint boundary line at
    // each stream segment's startPos and highlight the selected one.
    // Labels mark segment #. Click-to-select on zone body; drag a
    // "Zone N" chip to move its boundary (ghost line shows the target;
    // commit happens on mouseup — no live ground reflow).
    chipRects = [];
    if (editor.activeTool === 'ground') {
      const groundStream = b.items.filter((it) => it.kind === 'groundSet');
      const selectedGround = editor.selectedGroundSegment;
      // Header-highlight band at the very start.
      const isHeaderSelected = selectedGround === 'header';
      if (isHeaderSelected) {
        ctx.fillStyle = 'rgba(102, 224, 255, 0.08)';
        const firstStreamPos = groundStream[0]?.absoluteStartPos ?? (isH ? widthTiles : heightTiles);
        if (isH) ctx.fillRect(0, 0, firstStreamPos * TILE_PX, cssH);
        else ctx.fillRect(0, 0, cssW, firstStreamPos * TILE_PX);
      }
      // Draw each stream segment boundary + highlight if selected.
      for (let i = 0; i < groundStream.length; i++) {
        const gi = groundStream[i]!;
        const pos = gi.absoluteStartPos ?? 0;
        const isSel = selectedGround === gi;
        if (isSel) {
          const next = groundStream[i + 1]?.absoluteStartPos ?? (isH ? widthTiles : heightTiles);
          ctx.fillStyle = 'rgba(102, 224, 255, 0.12)';
          if (isH) ctx.fillRect(pos * TILE_PX, 0, (next - pos) * TILE_PX, cssH);
          else ctx.fillRect(0, pos * TILE_PX, cssW, (next - pos) * TILE_PX);
        }
        // Boundary at `pos` is the LEFT edge of `gi` AND the RIGHT edge
        // of the previous zone (or of the header when i === 0). Solid
        // when it borders the selected zone on either side.
        const prevZone = i > 0 ? groundStream[i - 1]! : 'header';
        const isSolid = isSel || selectedGround === prevZone;
        ctx.strokeStyle = isSolid ? '#66e0ff' : 'rgba(102, 224, 255, 0.55)';
        ctx.lineWidth = isSolid ? 2 : 1;
        if (!isSolid) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        if (isH) {
          ctx.moveTo(pos * TILE_PX + 0.5, 0);
          ctx.lineTo(pos * TILE_PX + 0.5, cssH);
        } else {
          ctx.moveTo(0, pos * TILE_PX + 0.5);
          ctx.lineTo(cssW, pos * TILE_PX + 0.5);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // Label — small chip with the zone number near the top/left of
        // the boundary. Numbering matches GroundPanel's 1-based "Zone N"
        // where the header (idx 0 in `zones`) = Zone 1 and stream zones
        // start at Zone 2 (i + 2 here since `i` indexes `groundStream`).
        const labelText = `Zone ${i + 2}`;
        ctx.font = 'bold 10px monospace';
        const metrics = ctx.measureText(labelText);
        const padX = 4, padY = 2;
        const lw = metrics.width + padX * 2;
        const lh = 12;
        const lx = isH ? pos * TILE_PX + 4 : 4;
        const ly = isH ? 4 : pos * TILE_PX + 4;
        ctx.fillStyle = '#66e0ff';
        ctx.fillRect(lx, ly, lw, lh);
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'top';
        ctx.fillText(labelText, lx + padX, ly + padY);
        chipRects.push({ item: gi, x: lx, y: ly, w: lw, h: lh });
      }
      // Label the header zone at the very start — it's Zone 1 in the panel.
      const headerLabel = 'Zone 1';
      ctx.font = 'bold 10px monospace';
      const hm = ctx.measureText(headerLabel);
      const hlw = hm.width + 8;
      ctx.fillStyle = isHeaderSelected ? '#66e0ff' : 'rgba(102, 224, 255, 0.7)';
      ctx.fillRect(4, 4, hlw, 12);
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      ctx.fillText(headerLabel, 8, 6);

      // Ghost line — shown during a chip drag at the target (snapped,
      // clamped) tile position. Not a commit; just shows where the
      // boundary will land when the user releases the button.
      const drag = groundResizeDrag.value;
      if (drag && (drag.item.absoluteStartPos ?? 0) !== drag.previewPos) {
        const gx = drag.previewPos * TILE_PX + 0.5;
        ctx.save();
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        if (isH) {
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, cssH);
        } else {
          ctx.moveTo(0, gx);
          ctx.lineTo(cssW, gx);
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // Selection rings — drawn as a single-tile box at the item anchor.
    // Multi-tile items show a small ring at the anchor; the full footprint
    // is still visible via the atlas blit. Keep this simple: computing
    // per-item footprint from the grid requires tracking regularId writes
    // across cells, which doesn't round-trip reliably when items overlap.
    for (const item of selectedItems.value) {
      if (item.tileX < 0 || item.tileY < 0) continue;
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.tileX * TILE_PX, item.tileY * TILE_PX, TILE_PX, TILE_PX);
    }

    // ── Ghost overlay (drag-move + resize + library drop) ──────
    //
    // `grid` already excludes the preview items, so it doubles as the
    // base for the diff. We clone it, stamp the preview items at their
    // new pos/size, and blit only the diff at alpha. This means:
    //   - live blockers (ground, clouds, other vines) stop vine ghosts
    //     correctly during the drag
    //   - priority-rejected placements show nothing (user sees it won't
    //     land)
    //   - no "duplicate" perception — the original is gone while the
    //     drag is in progress
    const libDrag = activeDrag.value;
    const libDragTile = ghostTile.value;
    const libItemActive =
      libDrag !== null && libDrag.kind === 'item' && libDragTile !== null;

    if (dragActive || resizeActive || libItemActive) {
      const ghostGrid = grid.clone();
      if (dragActive) {
        for (const src of selectedItems.value) {
          if (src.tileX < 0 || src.tileY < 0) continue;
          const previewItem: LevelItem = {
            ...src,
            tileX: src.tileX + dp.dx,
            tileY: src.tileY + dp.dy,
          } as LevelItem;
          renderItem(ghostGrid, previewItem, romData.rom, rom.activeSlot, b.header);
        }
      }
      if (resizeActive) {
        const previewItem: LevelItem = {
          ...rp.item,
          itemId: withSize(rp.item.itemId, rp.newSize),
        } as LevelItem;
        renderItem(ghostGrid, previewItem, romData.rom, rom.activeSlot, b.header);
      }
      if (libItemActive) {
        const romByte = libraryIdToRomByte(libDrag.id);
        const previewItem: LevelItem = {
          kind: ENTRANCE_ITEM_IDS.has(libDrag.id) ? 'entrance' : 'regular',
          itemId: romByte,
          tileX: libDragTile.x,
          tileY: libDragTile.y,
          sourceBytes: new Uint8Array([0, romByte & 0xff]),
          sourceRange: [0, 0],
        } as LevelItem;
        renderItem(ghostGrid, previewItem, romData.rom, rom.activeSlot, b.header);
      }

      ctx.save();
      ctx.globalAlpha = 0.55;
      drawCanvasDiff(ctx, ghostGrid, grid, palette);
      ctx.restore();

      // Dashed outline at each new anchor so the drop target is obvious
      // even when the ghost is mostly transparent.
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      if (dragActive) {
        for (const src of selectedItems.value) {
          if (src.tileX < 0 || src.tileY < 0) continue;
          const gx = src.tileX + dp.dx;
          const gy = src.tileY + dp.dy;
          ctx.strokeRect(gx * TILE_PX + 0.5, gy * TILE_PX + 0.5, TILE_PX - 1, TILE_PX - 1);
        }
      }
      if (libItemActive) {
        ctx.strokeRect(
          libDragTile.x * TILE_PX + 0.5,
          libDragTile.y * TILE_PX + 0.5,
          TILE_PX - 1, TILE_PX - 1,
        );
      }
      ctx.setLineDash([]);
    }

    // Resize handles — yellow squares at the end of each selected
    // extended item's footprint. If a resize is in progress, the handle
    // tracks the preview size so the user sees the pull point.
    for (const item of selectedItems.value) {
      if (!isResizable(item.itemId)) continue;
      const previewItem =
        rp && rp.item === item
          ? ({ ...item, itemId: withSize(item.itemId, rp.newSize) } as LevelItem)
          : item;
      const h = handlePosition(previewItem);
      const hx = h.x * TILE_PX + TILE_PX / 2;
      const hy = h.y * TILE_PX + TILE_PX / 2;
      ctx.fillStyle = '#ffcc00';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Enemy overlay — enemies use the overworld atlases (0-3) which contain
  // pre-colored enemy sprites. In the C++ tool (clvldraw_worker.cpp:48):
  //   m_Canvas.eColor = 3 - (*ed)[nlfEnemyColor];
  // Then DrawCanvas calls Draw(eColor, ...) → bmTpl[eColor] = one of
  // 5.bmp/6.bmp/7.bmp/9.bmp. Atlas 3 (9.bmp) is used for worlds/palettes
  // that need it — notably for bosses like Wart and Fryguy.
  // Helper: blit an enemy's multi-tile sprite from its atlas at a tile
  // position. Returns the footprint (cx × cy) so callers can draw rings
  // or bounding boxes. Mirrors C++ SetCanvasEnemyItem expansion.
  function blitEnemyAt(
    atlasSrc: HTMLImageElement,
    enemyId: number,
    tileX: number,
    tileY: number,
  ): { cx: number; cy: number } | null {
    const lookupId = enemyId & 0x7f;
    const dim = ENEMY_DIM[lookupId];
    if (!dim || dim[1] === 0xff) return null;
    const spriteId = dim[0]!;
    const szxy = dim[1]!;
    const cx = szxy & 0x0f;
    const cy = (szxy >> 4) & 0x0f;
    if (cx === 0 || cy === 0) return null;
    for (let iy = 0; iy < cy; iy++) {
      for (let ix = 0; ix < cx; ix++) {
        const tid = spriteId + (ix | (iy << 4));
        const { sx, sy } = metatileRect(tid);
        ctx.drawImage(
          atlasSrc, sx, sy, METATILE_SIZE, METATILE_SIZE,
          (tileX + ix) * TILE_PX, (tileY + iy) * TILE_PX, TILE_PX, TILE_PX,
        );
      }
    }
    return { cx, cy };
  }

  if (editor.showEnemies) {
    const enemyBlock = getEnemyBlock();
    const enemyAtlasIdx = 3 - (b.header.enemyColor & 0x03);
    const enemyAtlasSrc = getAtlasImage(enemyAtlasIdx);
    // During a drag, skip the solid render of every selected enemy so
    // only the ghost (rendered below) is visible. Sets give O(1) lookup.
    const edp = enemyDragPreview.value;
    const enemyDragActive = edp && (edp.dx !== 0 || edp.dy !== 0);
    const skipSet = new Set<EnemyItem>();
    if (enemyDragActive) {
      for (const s of selectedEnemies.value) skipSet.add(s.enemy);
    }
    const selectedSet = new Set<EnemyItem>();
    for (const s of selectedEnemies.value) selectedSet.add(s.enemy);

    if (enemyBlock && enemyAtlasSrc) {
      const isH = b.header.direction === 1;
      for (let pageIdx = 0; pageIdx < enemyBlock.pages.length; pageIdx++) {
        const page = enemyBlock.pages[pageIdx]!;
        for (const enemy of page.enemies) {
          if (skipSet.has(enemy)) continue;
          const { absX, absY } = enemyFootprint(enemy, pageIdx, isH);
          const footprint = blitEnemyAt(enemyAtlasSrc, enemy.id, absX, absY);
          if (!footprint) {
            ctx.fillStyle = 'rgba(255,80,80,0.6)';
            ctx.fillRect(absX * TILE_PX + 1, absY * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
          }
          if (selectedSet.has(enemy)) {
            const cx = footprint?.cx ?? 1;
            const cy = footprint?.cy ?? 1;
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(absX * TILE_PX, absY * TILE_PX, cx * TILE_PX, cy * TILE_PX);
          }
        }
      }
    }

    // Group ghost preview — one alpha wrap around the whole loop so the
    // blend cost is paid once for N enemies.
    if (enemyDragActive && selectedEnemies.value.length > 0 && enemyAtlasSrc) {
      const isH = b.header.direction === 1;
      ctx.save();
      ctx.globalAlpha = 0.55;
      const boxes: { absX: number; absY: number; cx: number; cy: number }[] = [];
      for (const sel of selectedEnemies.value) {
        const { absX: origAbsX, absY: origAbsY } = enemyFootprint(sel.enemy, sel.pageIndex, isH);
        const newAbsX = origAbsX + edp.dx;
        const newAbsY = origAbsY + edp.dy;
        const fp = blitEnemyAt(enemyAtlasSrc, sel.enemy.id, newAbsX, newAbsY);
        boxes.push({
          absX: newAbsX, absY: newAbsY,
          cx: fp?.cx ?? 1, cy: fp?.cy ?? 1,
        });
      }
      ctx.restore();

      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      for (const box of boxes) {
        ctx.strokeRect(
          box.absX * TILE_PX + 0.5, box.absY * TILE_PX + 0.5,
          box.cx * TILE_PX - 1, box.cy * TILE_PX - 1,
        );
      }
      ctx.setLineDash([]);
    }
  }

  // Library drop ghost — enemies are blitted directly from their atlas
  // (not through the canvas grid), so handle them here. Item ghosts are
  // handled inside the grid block above via drawCanvasDiff.
  const libEnemyDrag = activeDrag.value;
  const libEnemyTile = ghostTile.value;
  if (libEnemyDrag && libEnemyDrag.kind === 'enemy' && libEnemyTile) {
    const enemyAtlasIdx = 3 - (b.header.enemyColor & 0x03);
    const atlasSrc = getAtlasImage(enemyAtlasIdx);
    const dim = ENEMY_DIM[libEnemyDrag.id & 0x7f];
    if (atlasSrc && dim && dim[1] !== 0xff) {
      const spriteId = dim[0]!;
      const szxy = dim[1]!;
      const cx = szxy & 0x0f;
      const cy = (szxy >> 4) & 0x0f;
      ctx.save();
      ctx.globalAlpha = 0.55;
      for (let iy = 0; iy < cy; iy++) {
        for (let ix = 0; ix < cx; ix++) {
          const tid = spriteId + (ix | (iy << 4));
          const { sx, sy } = metatileRect(tid);
          ctx.drawImage(
            atlasSrc, sx, sy, METATILE_SIZE, METATILE_SIZE,
            (libEnemyTile.x + ix) * TILE_PX,
            (libEnemyTile.y + iy) * TILE_PX,
            TILE_PX, TILE_PX,
          );
        }
      }
      ctx.restore();
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(
        libEnemyTile.x * TILE_PX + 0.5,
        libEnemyTile.y * TILE_PX + 0.5,
        cx * TILE_PX - 1, cy * TILE_PX - 1,
      );
      ctx.setLineDash([]);
    }
  }

  // Rubber-band selection rectangle.
  const rb = rubberBand.value;
  if (rb) {
    ctx.fillStyle = 'rgba(255, 204, 0, 0.1)';
    ctx.fillRect(rb.x1 * TILE_PX, rb.y1 * TILE_PX,
      (rb.x2 - rb.x1 + 1) * TILE_PX, (rb.y2 - rb.y1 + 1) * TILE_PX);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(rb.x1 * TILE_PX + 0.5, rb.y1 * TILE_PX + 0.5,
      (rb.x2 - rb.x1 + 1) * TILE_PX - 1, (rb.y2 - rb.y1 + 1) * TILE_PX - 1);
    ctx.setLineDash([]);
  }

  // Info overlay.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 220, 28);
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(
    `${widthTiles}×${heightTiles} tiles · ${b.items.filter(i => i.tileX >= 0).length} items · ${b.header.direction === 1 ? 'horiz' : 'vert'}`,
    6,
    18,
  );
}

function redraw(): void {
  const canvas = canvasRef.value;
  const b = block.value;
  if (!canvas || !b) return;
  draw(canvas, b);
}

// Clear selection state when switching levels. Skipping the enemy side
// leaked a stale enemy reference into the new slot, which any mouseDown
// inside its (phantom) footprint would capture as a drag instead of
// falling through to click-to-select.
watch(() => rom.activeSlot, () => {
  selectedItems.value = [];
  selectedEnemies.value = [];
  enemyDragPreview.value = null;
  dragPreview.value = null;
  redraw();
});
watch(() => history.revision, redraw);
// Overlays (ground zone labels, selection rings, resize handles) are
// gated on `editor.activeTool` inside `draw()`. Without this watch, the
// canvas keeps its previous frame when you switch tabs, leaving stale
// overlays visible until some other event triggers a redraw.
watch(() => editor.activeTool, redraw);
onMounted(async () => {
  await Promise.all([preloadAllAtlases(), preloadHerbOverlays()]);
  redraw();
});

const dprMedia = window.matchMedia(
  `(resolution: ${window.devicePixelRatio}dppx)`,
);
onMounted(() => dprMedia.addEventListener('change', redraw));
onUnmounted(() => dprMedia.removeEventListener('change', redraw));

</script>

<template>
  <div
    class="relative h-full overflow-auto bg-[#111] outline-none"
    tabindex="0"
    @keydown="onKeyDown"
  >
    <canvas
      ref="canvasRef"
      class="block [image-rendering:pixelated]"
      :style="{ cursor: hoverCursor }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
    />
    <p
      v-if="!rom.activeBlock"
      class="absolute inset-0 flex items-center justify-center text-ink-muted text-sm"
    >
      Select a level from the list
    </p>
  </div>
</template>
