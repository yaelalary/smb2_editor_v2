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
import { activeDrag, hideNativeDragImage } from '@/ui/drag-state';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { getFxForSlot } from '@/rom/level-layout';
import {
  getAtlasImage,
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';
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

interface EnemyCategory {
  label: string;
  ids: number[];
}

const CATEGORIES: EnemyCategory[] = [
  { label: 'Common', ids: [1, 3, 2, 4, 9, 13, 14, 5, 6, 7] },
  { label: 'Flying', ids: [10, 11, 12, 15, 16, 18, 19] },
  { label: 'Bosses', ids: [28, 29, 31, 33, 42, 44] },
  { label: 'Hazards', ids: [8, 22, 26, 27, 35, 36, 37, 38, 46, 47, 48, 49, 59] },
  // Enemy-slot POW block (58 / dup 122) is omitted — has no runtime effect
  // in vanilla SMB2 (see docs/smb2-technical-notes.md). Only the item-slot
  // POW block (Blocks category in the tile library) is functional.
  { label: 'Items', ids: [0, 50, 51, 53, 54, 61, 62, 63, 64, 68, 69, 70] },
  { label: 'Special', ids: [20, 21, 23, 24, 25, 40, 41, 43, 45, 55, 60, 65, 66, 67, 71, 72, 73, 74] },
];

function enemyName(id: number): string {
  return ENEMY_NAMES[id] ?? `Enemy #${id}`;
}

interface EnemyFootprint {
  spriteId: number;
  cx: number;
  cy: number;
}

function enemyFootprint(id: number): EnemyFootprint | null {
  const dim = ENEMY_DIM[id];
  if (!dim) return null;
  const sid = dim[0];
  const szxy = dim[1];
  if (sid === undefined || sid === 0xff || szxy === undefined || szxy === 0xff) return null;
  const cx = szxy & 0x0f;
  const cy = (szxy >> 4) & 0x0f;
  if (cx === 0 || cy === 0) return null;
  return { spriteId: sid, cx, cy };
}

function onDragStart(e: DragEvent, enemyId: number): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(ENEMY_DRAG_MIME, JSON.stringify({ enemyId }));
  hideNativeDragImage(e);
  activeDrag.value = { kind: 'enemy', id: enemyId };
}

function onDragEnd(): void {
  activeDrag.value = null;
}

// Fit the preview inside a 32×32 CSS box, proportional. A 1×1 enemy
// renders at 32px (2× zoom); a 3×2 enemy renders at 32×~21px.
const PREVIEW_MAX_PX = 32;

function drawEnemy(el: unknown, eid: number): void {
  if (!el) return;
  const canvas = el as HTMLCanvasElement;
  // Enemies use the raw overworld atlas (0-2) — no palette colorization.
  // Matches C++ `Draw(eColor, ...)` which blits from masked bmTpl[0..3].
  const atlasIdx = Math.min(getFxForSlot(rom.activeSlot), 2);
  const src = getAtlasImage(atlasIdx);

  void drawGeneration.value;

  const fp = enemyFootprint(eid);
  if (!fp) return;

  const key = `${eid}:${atlasIdx}:${fp.cx}x${fp.cy}`;
  if (canvas.dataset['drawn'] === key) return;

  const w = fp.cx * METATILE_SIZE;
  const h = fp.cy * METATILE_SIZE;
  canvas.width = w;
  canvas.height = h;

  const scale = PREVIEW_MAX_PX / Math.max(w, h);
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
  canvas.style.imageRendering = 'pixelated';

  const ctx = canvas.getContext('2d');
  if (!ctx || !src) return;
  ctx.clearRect(0, 0, w, h);
  for (let iy = 0; iy < fp.cy; iy++) {
    for (let ix = 0; ix < fp.cx; ix++) {
      const tid = fp.spriteId + (ix | (iy << 4));
      const { sx, sy } = metatileRect(tid);
      ctx.drawImage(
        src, sx, sy, METATILE_SIZE, METATILE_SIZE,
        ix * METATILE_SIZE, iy * METATILE_SIZE, METATILE_SIZE, METATILE_SIZE,
      );
    }
  }
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
            @dragend="onDragEnd"
          >
            <canvas
              v-if="atlasReady && enemyFootprint(eid) !== null"
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
