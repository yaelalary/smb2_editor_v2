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
import { levelDimensions, ITEM_COLORS } from '@/rom/level-layout';
import type { LevelBlock, LevelItem } from '@/rom/model';
import { ITEM_DIM, getItemDimTiles } from '@/rom/nesleveldef';
import { DRAG_MIME } from '@/rom/item-categories';
import { PlaceTileCommand, DeleteItemCommand, MoveItemCommand } from '@/commands/tile-commands';
import {
  getAtlasImage,
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';

const TILE_PX = 16;
const DEFAULT_ATLAS_INDEX = 0;

const rom = useRomStore();
const history = useHistoryStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const selectedItem = ref<LevelItem | null>(null);

// Ghost position for drop preview.
const ghostTile = ref<{ x: number; y: number } | null>(null);

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

function hitTest(tileX: number, tileY: number): LevelItem | null {
  const b = block.value;
  if (!b) return null;
  for (const item of b.items) {
    if (item.tileX === tileX && item.tileY === tileY) return item;
  }
  return null;
}

// ─── Drop from TileLibrary ──────────────────────────────────────────

function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer?.types.includes(DRAG_MIME)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
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
  const b = block.value;
  if (!b || !e.dataTransfer) return;

  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return;

  let payload: { itemId: number };
  try {
    payload = JSON.parse(raw) as { itemId: number };
  } catch {
    return;
  }

  const tile = tileFromEvent(e);
  if (!tile) return;

  history.execute(
    new PlaceTileCommand(b, tile.x, tile.y, payload.itemId, rom.activeSlot),
  );
  redraw();
}

// ─── Click to select ────────────────────────────────────────────────

let mouseDownPos: { x: number; y: number } | null = null;

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return; // left button only
  mouseDownPos = tileFromEvent(e);
}

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 0) return;
  const upPos = tileFromEvent(e);
  if (!upPos || !mouseDownPos) {
    mouseDownPos = null;
    return;
  }

  // If dragging a selected item to a new position:
  if (
    selectedItem.value &&
    (upPos.x !== mouseDownPos.x || upPos.y !== mouseDownPos.y) &&
    selectedItem.value.tileX === mouseDownPos.x &&
    selectedItem.value.tileY === mouseDownPos.y
  ) {
    const b = block.value;
    if (b) {
      history.execute(
        new MoveItemCommand(b, selectedItem.value, upPos.x, upPos.y, rom.activeSlot),
      );
    }
    mouseDownPos = null;
    redraw();
    return;
  }

  // Otherwise: click to select/deselect.
  const hit = hitTest(upPos.x, upPos.y);
  selectedItem.value = hit;
  mouseDownPos = null;
  redraw();
}

// ─── Delete key ─────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const item = selectedItem.value;
    const b = block.value;
    if (!item || !b) return;
    e.preventDefault();
    history.execute(new DeleteItemCommand(b, item, rom.activeSlot));
    selectedItem.value = null;
    redraw();
  }
}

// ─── Drawing ────────────────────────────────────────────────────────

function resolveMetatileId(
  rawId: number,
  fx: number,
  objectType: number,
): number | null {
  if (rawId < 0) return null;
  if (rawId < 48) {
    const dim = ITEM_DIM[rawId];
    const tile = dim?.[0];
    return tile !== undefined && tile !== 0xff ? tile : null;
  }
  const baseType = (rawId - 48) >> 4;
  const tiles = getItemDimTiles(baseType + 48, fx, objectType);
  const tile = tiles[0];
  return tile !== undefined && tile !== 0xff ? tile : null;
}

function drawItemOnCanvas(
  ctx: CanvasRenderingContext2D,
  item: LevelItem,
  objectType: number,
  isSelected: boolean,
): void {
  if (item.tileX < 0 || item.tileY < 0) return;
  const x = item.tileX * TILE_PX;
  const y = item.tileY * TILE_PX;

  const atlas = getAtlasImage(DEFAULT_ATLAS_INDEX);
  const tileId = resolveMetatileId(item.itemId, 0, objectType);

  if (atlas && tileId !== null) {
    const { sx, sy } = metatileRect(tileId);
    ctx.drawImage(atlas, sx, sy, METATILE_SIZE, METATILE_SIZE, x, y, TILE_PX, TILE_PX);
  } else {
    const color = ITEM_COLORS[item.kind] ?? '#666';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PX - 1);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = item.itemId >= 0 ? item.itemId.toString(16).toUpperCase() : '?';
    ctx.fillText(label, x + TILE_PX / 2, y + TILE_PX / 2, TILE_PX - 4);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Selection ring.
  if (isSelected) {
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, TILE_PX, TILE_PX);
  }
}

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

  // Background.
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid.
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
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
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
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

  // Items.
  for (const item of b.items) {
    drawItemOnCanvas(ctx, item, b.header.objectType, item === selectedItem.value);
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

  // Info overlay.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, 220, 28);
  ctx.fillStyle = '#ccc';
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
  selectedItem.value = null;
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
