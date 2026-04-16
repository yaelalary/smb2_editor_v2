<script setup lang="ts">
/**
 * Tile library sidebar — Unit 9.
 *
 * A categorized palette of all 61 placeable item types. Each item
 * shows its metatile sprite (from atlas-0) + name, and is draggable
 * via HTML5 DnD. On `dragstart`, the item's ID is set as the
 * transfer payload so the canvas drop handler (Unit 10) knows what
 * was dropped.
 *
 * Items 0-47: fixed-size, sprite from ITEM_DIM[id][0] (topleft tile).
 * Items 48-60: variable-size, sprite from SITEM_DIM[fx][objType][baseType][0].
 *   For the library preview we use fx=0, objType=0 as a representative.
 *
 * The drag MIME type is 'application/smb2-item' with a JSON payload:
 *   { "itemId": number }
 */
import { onMounted, ref } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { ITEM_CATEGORIES, DRAG_MIME } from '@/rom/item-categories';
import { ITEM_NAMES, ITEM_DIM, getItemDimTiles } from '@/rom/nesleveldef';
import {
  getAtlasImage,
  metatileRect,
  preloadAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';

const atlasReady = ref(false);

onMounted(async () => {
  await preloadAtlases([0]);
  atlasReady.value = true;
});

/**
 * Get the primary metatile ID for an item (used for the library icon).
 * Returns null when the item has no primary tile (0xFF = transparent).
 */
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
            <!-- Sprite preview from atlas -->
            <canvas
              v-if="atlasReady && primaryTileId(itemId) !== null"
              :ref="(el) => {
                if (!el) return;
                const canvas = el as HTMLCanvasElement;
                const atlas = getAtlasImage(0);
                if (!atlas || canvas.dataset['drawn'] === String(itemId)) return;
                canvas.width = METATILE_SIZE;
                canvas.height = METATILE_SIZE;
                canvas.style.width = '24px';
                canvas.style.height = '24px';
                canvas.style.imageRendering = 'pixelated';
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                const tid = primaryTileId(itemId)!;
                const { sx, sy } = metatileRect(tid);
                ctx.drawImage(atlas, sx, sy, METATILE_SIZE, METATILE_SIZE, 0, 0, METATILE_SIZE, METATILE_SIZE);
                canvas.dataset['drawn'] = String(itemId);
              }"
              class="shrink-0 bg-black/20 rounded-sm"
            />
            <!-- Fallback when no sprite -->
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
