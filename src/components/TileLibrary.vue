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
import { ITEM_NAMES, ITEM_DIM, getItemDimTiles } from '@/rom/nesleveldef';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { getFxForSlot } from '@/rom/level-layout';
import { readLevelPalette } from '@/rom/palette-reader';
import {
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
  getColorizedAtlas,
} from '@/assets/metatiles';

const rom = useRomStore();
const history = useHistoryStore();
const atlasReady = ref(false);
const drawGeneration = ref(0);

onMounted(async () => {
  await preloadAllAtlases();
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

function getItemAtlasIndex(): number {
  return getFxForSlot(rom.activeSlot) + 4;
}

function primaryTileId(itemId: number): number | null {
  let tiles: readonly number[];
  if (itemId < 48) {
    tiles = ITEM_DIM[itemId] ?? [];
  } else {
    tiles = getItemDimTiles(itemId, 0, 0);
  }
  const t = tiles[0];
  return t !== undefined && t !== 0xff ? t : null;
}

function onDragStart(e: DragEvent, itemId: number): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ itemId }));
}

function itemName(id: number): string {
  return ITEM_NAMES[id] ?? `Item #${id}`;
}

function drawTile(el: unknown, itemId: number): void {
  if (!el) return;
  const canvas = el as HTMLCanvasElement;
  const palette = getCurrentPalette();
  const atlasIdx = getItemAtlasIndex();
  const src = palette ? getColorizedAtlas(atlasIdx, palette) : null;

  // Stamp generation so Vue re-runs this when drawGeneration changes
  void drawGeneration.value;

  const key = `${itemId}:${atlasIdx}:${palette?.nesIndices.join(',') ?? ''}`;
  if (canvas.dataset['drawn'] === key) return;

  canvas.width = METATILE_SIZE;
  canvas.height = METATILE_SIZE;
  canvas.style.width = '24px';
  canvas.style.height = '24px';
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (!ctx || !src) return;

  ctx.clearRect(0, 0, METATILE_SIZE, METATILE_SIZE);
  const tid = primaryTileId(itemId);
  if (tid === null) return;
  const { sx, sy } = metatileRect(tid);
  ctx.drawImage(src, sx, sy, METATILE_SIZE, METATILE_SIZE, 0, 0, METATILE_SIZE, METATILE_SIZE);
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
          >
            <canvas
              v-if="atlasReady && primaryTileId(itemId) !== null"
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
