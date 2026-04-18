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
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { levelDimensions, getFxForSlot } from '@/rom/level-layout';
import { readLevelPalette } from '@/rom/palette-reader';
import type { LevelBlock, LevelItem, EnemyBlock, EnemyItem } from '@/rom/model';
import { ENEMY_DIM } from '@/rom/nesleveldef';
import { getWorldGfx } from '@/rom/tile-reader';
import { DRAG_MIME, ENEMY_DRAG_MIME } from '@/rom/item-categories';
import { PlaceTileCommand, DeleteItemCommand, MoveItemCommand, DeleteItemsCommand, MoveItemsCommand } from '@/commands/tile-commands';
import { PlaceEnemyCommand, DeleteEnemyCommand } from '@/commands/enemy-commands';
import { renderItem } from '@/rom/item-renderer';
import { CanvasGrid } from '@/rom/canvas-grid';
import { computeGroundSegments, groundPass } from '@/rom/ground-pass';
import { drawCanvas } from '@/rom/canvas-draw';
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
const selectedItems = ref<LevelItem[]>([]);
const selectedEnemy = ref<{ enemy: EnemyItem; pageIndex: number } | null>(null);

// Ghost position for drop preview.
const ghostTile = ref<{ x: number; y: number } | null>(null);

// Rubber-band selection rectangle (tile coordinates).
const rubberBand = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

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

function hitTestTile(tileX: number, tileY: number): LevelItem | null {
  const b = block.value;
  if (!b) return null;
  for (const item of b.items) {
    if (item.tileX === tileX && item.tileY === tileY) return item;
  }
  return null;
}

function hitTestEnemy(tileX: number, tileY: number): { enemy: EnemyItem; pageIndex: number } | null {
  const eb = getEnemyBlock();
  if (!eb) return null;
  const isH = block.value?.header.direction === 1;
  for (let pageIdx = 0; pageIdx < eb.pages.length; pageIdx++) {
    const page = eb.pages[pageIdx]!;
    for (const enemy of page.enemies) {
      // Mirrors C++ cneseditor_loader.cpp:119-129.
      const ex = isH ? pageIdx * 16 + enemy.x : enemy.x;
      const ey = isH ? enemy.y : pageIdx * 16 + enemy.y;
      // Consider the full multi-tile footprint (cx × cy).
      const szxy = ENEMY_DIM[enemy.id]?.[1] ?? 0xff;
      const cx = szxy === 0xff ? 1 : Math.max(1, szxy & 0x0f);
      const cy = szxy === 0xff ? 1 : Math.max(1, (szxy >> 4) & 0x0f);
      if (tileX >= ex && tileX < ex + cx && tileY >= ey && tileY < ey + cy) {
        return { enemy, pageIndex: pageIdx };
      }
    }
  }
  return null;
}

function getEnemyBlock(): EnemyBlock | null {
  const map = rom.enemyMap;
  if (!map) return null;
  const idx = map.slotToBlock[rom.activeSlot];
  if (idx === undefined) return null;
  return (map.blocks[idx] as EnemyBlock) ?? null;
}

// ─── Drop from TileLibrary or EnemyLibrary ──────────────────────────

function onDragOver(e: DragEvent): void {
  const types = e.dataTransfer?.types;
  if (!types?.includes(DRAG_MIME) && !types?.includes(ENEMY_DRAG_MIME)) return;
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
      history.execute(
        new PlaceEnemyCommand(eb, tile.x, tile.y, payload.enemyId, rom.activeSlot),
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

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  mouseDownPos = tileFromEvent(e);
  isDraggingSelection = false;
  rubberBand.value = null;
}

function onMouseMove(e: MouseEvent): void {
  if (!mouseDownPos || e.buttons !== 1) return;
  if (editor.activeTool !== 'tiles') return;

  const pos = tileFromEvent(e);
  if (!pos) return;

  // If dragging from a selected item → will be a group move on mouseUp
  if (selectedItems.value.some((it) => it.tileX === mouseDownPos!.x && it.tileY === mouseDownPos!.y)) {
    return;
  }

  // Rubber-band: drag from empty space
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

  // ─── Enemy mode ────────────────────────────────────────────────
  if (editor.activeTool === 'enemies') {
    const hitE = hitTestEnemy(upPos.x, upPos.y);
    selectedEnemy.value = hitE;
    selectedItems.value = [];
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
    selectedEnemy.value = null;
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
    mouseDownPos = null;
    redraw();
    return;
  }

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
  selectedEnemy.value = null;
  mouseDownPos = null;
  redraw();
}

// ─── Delete key ─────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();

    // Delete selected enemy?
    if (selectedEnemy.value) {
      const eb = getEnemyBlock();
      if (eb) {
        history.execute(
          new DeleteEnemyCommand(eb, selectedEnemy.value.pageIndex, selectedEnemy.value.enemy, rom.activeSlot),
        );
        selectedEnemy.value = null;
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

    const grid = new CanvasGrid(widthTiles, heightTiles, fx, gfx, isH);
    const segments = computeGroundSegments(b);
    groundPass(grid, romData.rom, world, segments);
    for (const item of b.items) {
      renderItem(grid, item, romData.rom, rom.activeSlot, b.header);
    }
    drawCanvas(ctx, grid, palette);

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
  }

  // Enemy overlay — enemies use the overworld atlases (0-3) which contain
  // pre-colored enemy sprites. In the C++ tool (clvldraw_worker.cpp:48):
  //   m_Canvas.eColor = 3 - (*ed)[nlfEnemyColor];
  // Then DrawCanvas calls Draw(eColor, ...) → bmTpl[eColor] = one of
  // 5.bmp/6.bmp/7.bmp/9.bmp. Atlas 3 (9.bmp) is used for worlds/palettes
  // that need it — notably for bosses like Wart and Fryguy.
  if (editor.showEnemies) {
    const enemyBlock = getEnemyBlock();
    const enemyAtlasIdx = 3 - (b.header.enemyColor & 0x03);
    const enemyAtlasSrc = getAtlasImage(enemyAtlasIdx);
    if (enemyBlock && enemyAtlasSrc) {
      const isH = b.header.direction === 1;
      for (let pageIdx = 0; pageIdx < enemyBlock.pages.length; pageIdx++) {
        const page = enemyBlock.pages[pageIdx]!;
        for (const enemy of page.enemies) {
          // C++ cneseditor_loader.cpp:119-129 enemy position transform.
          const absX = isH ? pageIdx * 16 + enemy.x : enemy.x;
          const absY = isH ? enemy.y : pageIdx * 16 + enemy.y;
          const ex = absX * TILE_PX;
          const ey = absY * TILE_PX;
          const dim = ENEMY_DIM[enemy.id];
          const spriteId = dim?.[0];
          const szxy = dim?.[1] ?? 0xff;
          const cx = szxy === 0xff ? 0 : (szxy & 0x0f);
          const cy = szxy === 0xff ? 0 : ((szxy >> 4) & 0x0f);
          if (spriteId !== undefined && szxy !== 0xff && cx > 0 && cy > 0) {
            // C++ SetCanvasEnemyItem: expand into cx × cy tiles,
            // each tile = baseSpriteId + (ix | (iy << 4)).
            for (let iy = 0; iy < cy; iy++) {
              for (let ix = 0; ix < cx; ix++) {
                const tid = spriteId + (ix | (iy << 4));
                const { sx, sy } = metatileRect(tid);
                ctx.drawImage(
                  enemyAtlasSrc, sx, sy, METATILE_SIZE, METATILE_SIZE,
                  ex + ix * TILE_PX, ey + iy * TILE_PX, TILE_PX, TILE_PX,
                );
              }
            }
          } else {
            ctx.fillStyle = 'rgba(255,80,80,0.6)';
            ctx.fillRect(ex + 1, ey + 1, TILE_PX - 2, TILE_PX - 2);
          }
          // Selection ring covers the full enemy footprint.
          if (selectedEnemy.value?.enemy === enemy) {
            const w = cx > 0 ? cx * TILE_PX : TILE_PX;
            const h = cy > 0 ? cy * TILE_PX : TILE_PX;
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(ex, ey, w, h);
          }
        }
      }
    }
  }

  // Drop ghost preview.
  const ghost = ghostTile.value;
  if (ghost) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(ghost.x * TILE_PX, ghost.y * TILE_PX, TILE_PX, TILE_PX);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(ghost.x * TILE_PX + 0.5, ghost.y * TILE_PX + 0.5, TILE_PX - 1, TILE_PX - 1);
    ctx.setLineDash([]);
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

// Clear selection when switching levels.
watch(() => rom.activeSlot, () => {
  selectedItems.value = [];
  redraw();
});
watch(() => history.revision, redraw);
onMounted(async () => {
  await preloadAllAtlases();
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
    class="relative h-full overflow-auto bg-[#111]"
    tabindex="0"
    @keydown="onKeyDown"
  >
    <canvas
      ref="canvasRef"
      class="block [image-rendering:pixelated]"
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
