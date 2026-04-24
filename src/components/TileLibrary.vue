<script setup lang="ts">
/**
 * Tile library sidebar — Unit 9.
 *
 * A categorized palette of all 61 placeable item types. Each item
 * shows its metatile sprite (from the level's item atlas, palette-
 * colorized) + name, and is draggable via HTML5 DnD.
 *
 * The atlas used depends on the current level's FX value:
 *   fx=0 → atlas 4, fx=1 → atlas 5, fx=2 → atlas 6, fx=3 → atlas 7.
 * Colors are remapped through the level's NES palette.
 */
import { onMounted, ref, watch, nextTick } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { ITEM_CATEGORIES, DRAG_MIME } from '@/rom/item-categories';
import { activeDrag, hideNativeDragImage } from '@/ui/drag-state';
import { ITEM_NAMES, ITEM_DIM, getItemDimTiles } from '@/rom/nesleveldef';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { getFxForSlot } from '@/rom/level-layout';
import { getWorldGfx } from '@/rom/tile-reader';
import { readLevelPalette } from '@/rom/palette-reader';
import { CanvasGrid } from '@/rom/canvas-grid';
import { renderItem } from '@/rom/item-renderer';
import { drawCanvas } from '@/rom/canvas-draw';
import { libraryIdToRomByte } from '@/commands/tile-commands';
import { ENTRANCE_ITEM_IDS } from '@/rom/constants';
import { drawHerbOverlay, enemyAtlasForLevel, hasHerbOverlay, preloadHerbOverlays } from '@/ui/herb-overlays';
import type { LevelItem } from '@/rom/model';
import {
  preloadAllAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';

const rom = useRomStore();
const history = useHistoryStore();
const atlasReady = ref(false);
const drawGeneration = ref(0);

onMounted(async () => {
  await Promise.all([preloadAllAtlases(), preloadHerbOverlays()]);
  atlasReady.value = true;
});

// Re-draw library thumbnails when slot changes (different world = different atlas + palette)
watch(
  () => [rom.activeSlot, history.revision],
  () => { drawGeneration.value++; nextTick(() => { drawGeneration.value++; }); },
);

function getCurrentPalette() {
  const romData = rom.romData;
  if (!romData) return null;
  const b = rom.activeBlock;
  if (!b) return null;
  return readLevelPalette(romData.rom, rom.activeSlot, (b as { header: { palette: number } }).header.palette);
}

function hasPreviewTile(itemId: number): boolean {
  let tiles: readonly number[];
  if (itemId < 48) {
    tiles = ITEM_DIM[itemId] ?? [];
  } else {
    tiles = getItemDimTiles(itemId, 0, 0);
  }
  const t = tiles[0];
  return t !== undefined && t !== 0xff;
}

function onDragStart(e: DragEvent, itemId: number): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ itemId }));
  // Hide the default drag image (library card screenshot) and publish
  // the payload so the canvas ghost-renders the actual sprite instead.
  hideNativeDragImage(e);
  activeDrag.value = { kind: 'item', id: itemId };
}

function onDragEnd(): void {
  activeDrag.value = null;
}

function itemName(id: number): string {
  return ITEM_NAMES[id] ?? `Item #${id}`;
}

// Library previews route through the same `renderItem` + `drawCanvas`
// pipeline used by the editor canvas, so the sprite shown in the library
// is exactly what `PlaceTileCommand` produces. Avoids the class of bugs
// where library uses one atlas path (e.g., item atlas) while the editor
// uses another (e.g., BG atlas for ground items).
const PREVIEW_MAX_PX = 32;
const PREVIEW_GRID = 4;

function drawTile(el: unknown, libraryId: number): void {
  if (!el) return;
  const canvas = el as HTMLCanvasElement;
  const palette = getCurrentPalette();
  const romData = rom.romData;
  const b = rom.activeBlock;
  if (!palette || !romData || !b) return;
  const header = (b as { header: { direction: number; palette: number; objectType: number } }).header;

  void drawGeneration.value;

  const slot = rom.activeSlot;
  const fx = getFxForSlot(slot);
  const world = Math.floor(slot / 30);
  const gfx = getWorldGfx(romData.rom, world);
  const isH = header.direction === 1;

  const key = `${libraryId}:${fx}:${gfx}:${header.objectType}:${palette.nesIndices.join(',')}`;
  if (canvas.dataset['drawn'] === key) return;

  const itemId = libraryIdToRomByte(libraryId);
  // Item 20 ("Entrance/exit light left") is right-anchored — its
  // `renderEntrance` draws at posX-2, posX-1, posX. With tileX=0 those
  // land at x=-2,-1,0 and fall outside the preview grid, leaving the
  // thumbnail blank. Anchor at tileX=2 so the 3-tile-wide sprite lands
  // at x=0,1,2 and renders fully.
  const anchorX = libraryId === 20 ? 2 : 0;
  const previewItem: LevelItem = {
    kind: ENTRANCE_ITEM_IDS.has(libraryId) ? 'entrance' : 'regular',
    itemId,
    tileX: anchorX,
    tileY: 0,
    sourceBytes: new Uint8Array([0, itemId & 0xff]),
    sourceRange: [0, 0],
  } as LevelItem;

  const grid = new CanvasGrid(PREVIEW_GRID, PREVIEW_GRID, fx, gfx, isH);
  renderItem(grid, previewItem, romData.rom, slot, header as never);

  // Crop to the bbox of visible cells so 1×1 items show compact, while
  // multi-tile items (doors, big clouds, hawkmouth) show their real shape.
  let minX = PREVIEW_GRID, minY = PREVIEW_GRID, maxX = -1, maxY = -1;
  for (let y = 0; y < PREVIEW_GRID; y++) {
    for (let x = 0; x < PREVIEW_GRID; x++) {
      if (grid.getItem(x, y).visible) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;

  const tileW = (maxX - minX + 1) * METATILE_SIZE;
  const tileH = (maxY - minY + 1) * METATILE_SIZE;
  // Herb overlays float above the tile (y negative). Reserve headroom
  // so the sprite doesn't get clipped by the canvas top.
  const overlayHeadroom = hasHerbOverlay(libraryId)
    ? Math.ceil(METATILE_SIZE * 0.55)
    : 0;
  const w = tileW;
  const h = tileH + overlayHeadroom;
  canvas.width = w;
  canvas.height = h;
  const scale = PREVIEW_MAX_PX / Math.max(w, h);
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
  canvas.style.imageRendering = 'pixelated';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  // Draw tiles shifted down by the headroom so the overlay can occupy
  // the top band without negative-y clipping.
  ctx.translate(-minX * METATILE_SIZE, -minY * METATILE_SIZE + overlayHeadroom);
  drawCanvas(ctx, grid, palette);
  ctx.restore();

  // Herb variants (items 32-42 / 43 / 45) paint a small content sprite
  // above the tile so the library is readable at a glance.
  if (hasHerbOverlay(libraryId)) {
    const enemyAtlas = enemyAtlasForLevel((b as { header: { enemyColor: number } }).header.enemyColor);
    drawHerbOverlay(ctx, 0, overlayHeadroom, METATILE_SIZE, libraryId, enemyAtlas);
  }

  canvas.dataset['drawn'] = key;
}
</script>

<template>
  <BasePanel title="Library">
    <div class="divide-y divide-panel-border">
      <details
        v-for="cat in ITEM_CATEGORIES"
        :key="cat.label"
        class="group"
        open
      >
        <summary
          class="px-3 py-2 text-xs font-semibold text-ink-muted uppercase tracking-wide cursor-pointer
                 select-none hover:bg-panel-subtle sticky top-0 bg-panel z-10"
        >
          {{ cat.label }}
          <span class="text-ink-muted font-normal lowercase">({{ cat.items.length }})</span>
        </summary>

        <div class="grid grid-cols-2 gap-1 p-2">
          <div
            v-for="itemId in cat.items"
            :key="itemId"
            :draggable="true"
            :title="itemName(itemId)"
            class="flex items-center gap-2 px-2 py-1.5 rounded
                   cursor-grab active:cursor-grabbing
                   hover:bg-panel-subtle transition-colors
                   border border-transparent hover:border-panel-border"
            @dragstart="(e) => onDragStart(e, itemId)"
            @dragend="onDragEnd"
          >
            <canvas
              v-if="atlasReady && hasPreviewTile(itemId)"
              :key="`${itemId}-${drawGeneration}`"
              :ref="(el) => drawTile(el, itemId)"
              class="shrink-0 bg-black/20 rounded-sm"
            />
            <div
              v-else
              class="w-6 h-6 shrink-0 rounded-sm bg-accent/20 flex items-center justify-center text-[8px] font-mono text-ink-muted"
            >
              {{ itemId.toString(16).toUpperCase() }}
            </div>

            <span class="text-[10px] text-ink-muted truncate leading-tight">
              {{ itemName(itemId) }}
            </span>
          </div>
        </div>
      </details>
    </div>
  </BasePanel>
</template>
