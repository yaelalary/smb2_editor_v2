<script setup lang="ts">
/**
 * Enemy library — Unit 11.
 *
 * Categorized palette of enemy types. Same UX as TileLibrary but for
 * enemies. Drag from here onto the canvas to place enemies.
 * Uses atlas-8 (enemy sprites) with palette colorization.
 */
import { onMounted, ref, watch, nextTick } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { ENEMY_NAMES, ENEMY_DIM } from '@/rom/nesleveldef';
import { ENEMY_DRAG_MIME } from '@/rom/item-categories';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { readLevelPalette } from '@/rom/palette-reader';
import {
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
  getColorizedAtlas,
} from '@/assets/metatiles';

const ENEMY_ATLAS = 8;
const rom = useRomStore();
const history = useHistoryStore();
const atlasReady = ref(false);
const drawGeneration = ref(0);

onMounted(async () => {
  await preloadAllAtlases();
  atlasReady.value = true;
});

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

interface EnemyCategory {
  label: string;
  ids: number[];
}

const CATEGORIES: EnemyCategory[] = [
  { label: 'Common', ids: [1, 3, 2, 4, 9, 13, 14, 5, 6, 7] },
  { label: 'Flying', ids: [10, 11, 12, 15, 16, 18, 19] },
  { label: 'Bosses', ids: [28, 29, 31, 33, 42, 44] },
  { label: 'Hazards', ids: [8, 22, 26, 27, 35, 36, 37, 38, 46, 47, 48, 49, 59] },
  { label: 'Items', ids: [0, 50, 51, 53, 54, 58, 61, 62, 63, 64, 68, 69, 70] },
  { label: 'Special', ids: [20, 21, 23, 24, 25, 40, 41, 43, 45, 55, 60, 65, 66, 67, 71, 72, 73, 74] },
];

function enemyName(id: number): string {
  return ENEMY_NAMES[id] ?? `Enemy #${id}`;
}

function spriteId(id: number): number | null {
  const dim = ENEMY_DIM[id];
  if (!dim) return null;
  const s = dim[0];
  return s !== undefined && s !== 0xff ? s : null;
}

function onDragStart(e: DragEvent, enemyId: number): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(ENEMY_DRAG_MIME, JSON.stringify({ enemyId }));
}

function drawEnemy(el: unknown, eid: number): void {
  if (!el) return;
  const canvas = el as HTMLCanvasElement;
  const palette = getCurrentPalette();
  const src = palette ? getColorizedAtlas(ENEMY_ATLAS, palette) : null;

  void drawGeneration.value;

  const key = `${eid}:${palette?.nesIndices.join(',') ?? ''}`;
  if (canvas.dataset['drawn'] === key) return;

  canvas.width = METATILE_SIZE;
  canvas.height = METATILE_SIZE;
  canvas.style.width = '24px';
  canvas.style.height = '24px';
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (!ctx || !src) return;

  ctx.clearRect(0, 0, METATILE_SIZE, METATILE_SIZE);
  const sid = spriteId(eid);
  if (sid === null) return;
  const { sx, sy } = metatileRect(sid);
  ctx.drawImage(src, sx, sy, METATILE_SIZE, METATILE_SIZE, 0, 0, METATILE_SIZE, METATILE_SIZE);
  canvas.dataset['drawn'] = key;
}
</script>

<template>
  <BasePanel title="Enemies">
    <div class="divide-y divide-panel-border">
      <details
        v-for="cat in CATEGORIES"
        :key="cat.label"
        class="group"
        open
      >
        <summary
          class="px-3 py-2 text-xs font-semibold text-ink-muted uppercase tracking-wide cursor-pointer
                 select-none hover:bg-panel-subtle sticky top-0 bg-panel z-10"
        >
          {{ cat.label }}
          <span class="font-normal lowercase">({{ cat.ids.length }})</span>
        </summary>

        <div class="grid grid-cols-2 gap-1 p-2">
          <div
            v-for="eid in cat.ids"
            :key="eid"
            :draggable="true"
            :title="enemyName(eid)"
            class="flex items-center gap-2 px-2 py-1.5 rounded
                   cursor-grab active:cursor-grabbing
                   hover:bg-panel-subtle transition-colors
                   border border-transparent hover:border-panel-border"
            @dragstart="(e) => onDragStart(e, eid)"
          >
            <canvas
              v-if="atlasReady && spriteId(eid) !== null"
              :key="`${eid}-${drawGeneration}`"
              :ref="(el) => drawEnemy(el, eid)"
              class="shrink-0 bg-black/20 rounded-sm"
            />
            <div
              v-else
              class="w-6 h-6 shrink-0 rounded-sm bg-status-danger/20 flex items-center justify-center text-[8px] font-mono text-ink-muted"
            >
              {{ eid }}
            </div>

            <span class="text-[10px] text-ink-muted truncate leading-tight">
              {{ enemyName(eid) }}
            </span>
          </div>
        </div>
      </details>
    </div>
  </BasePanel>
</template>
