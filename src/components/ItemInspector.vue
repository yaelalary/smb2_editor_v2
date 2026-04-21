<script setup lang="ts">
/**
 * Item Inspector — right-panel view shown when exactly one item is
 * selected on the canvas. Exposes per-item properties, most notably
 * the routing destination for entrances and enterable jars.
 *
 * Non-goals:
 *   - Multi-item editing (fallback to level properties instead).
 *   - Extended 0xF5 destinations (block-pointer; needs advanced UI).
 */
import { computed, nextTick } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { ITEM_NAMES } from '@/rom/nesleveldef';
import { slotLabel, slotLabelVerbose, levelDimensions } from '@/rom/level-layout';
import { MAX_LEVELS, ENTRANCE_ITEM_IDS } from '@/rom/constants';
import {
  SetItemDestinationCommand,
  itemDestination,
  itemDestinationSlot,
} from '@/commands/routing-commands';
import { DeleteItemCommand } from '@/commands/tile-commands';
import type { LevelBlock, LevelItem } from '@/rom/model';

/** Jar ids that are enterable (go to sub-space or warp). Item 4 is static. */
const ENTERABLE_JAR_IDS: ReadonlySet<number> = new Set([0x06, 0x07, 0x08]);

/** Jar ids used as warp zones (go to multiple pointer destinations). */
const WARP_JAR_IDS: ReadonlySet<number> = new Set([0x08]);

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();

const item = computed<LevelItem | null>(() => {
  void history.revision;
  const sel = editor.selectedItems;
  return sel.length === 1 ? sel[0]! : null;
});

const block = computed<LevelBlock | null>(() => {
  void history.revision;
  const b = rom.activeBlock;
  return b ? (b as LevelBlock) : null;
});

const itemName = computed<string>(() => {
  const it = item.value;
  if (!it) return '';
  const id = it.itemId;
  return ITEM_NAMES[id] ?? `Item #${id}`;
});

const itemIdHex = computed<string>(() => {
  const it = item.value;
  if (!it) return '';
  return `0x${it.itemId.toString(16).toUpperCase().padStart(2, '0')}`;
});

/** Is this item capable of holding a destination (entrance or enterable jar)? */
const canRoute = computed<boolean>(() => {
  const it = item.value;
  if (!it) return false;
  if (it.kind === 'entrance') return true;
  if (it.kind === 'regular' && ENTERABLE_JAR_IDS.has(it.itemId)) return true;
  return false;
});

const isWarpJar = computed<boolean>(() => {
  const it = item.value;
  return !!it && WARP_JAR_IDS.has(it.itemId);
});

const decodedDest = computed(() => {
  // SetItemDestinationCommand mutates `item.sourceBytes` in place — the
  // LevelItem reference doesn't change, so `item.value === item.value`
  // and Vue wouldn't otherwise re-run this computed. Touching
  // `history.revision` forces a recompute on every command.
  void history.revision;
  const it = item.value;
  return it ? itemDestination(it) : null;
});

const destSlot = computed<number | null>(() => decodedDest.value?.slot ?? null);
const destPage = computed<number | null>(() => decodedDest.value?.page ?? null);
const destFar = computed<boolean>(() => decodedDest.value?.farPointer ?? false);

/** Friendly summary of the destination block for UI hinting. */
function blockSummary(slot: number): string {
  const lm = rom.levelMap;
  if (!lm) return '';
  const b = lm.blocks[lm.slotToBlock[slot] ?? -1];
  if (!b) return '';
  const dir = b.header.direction === 1 ? 'H' : 'V';
  const { widthTiles, heightTiles } = levelDimensions(b as unknown as LevelBlock);
  return `${dir}, ${widthTiles}×${heightTiles}, ${b.items.length} items`;
}

const allRoomOptions = computed<{ slot: number; label: string; title: string }[]>(() => {
  void history.revision;
  const opts: { slot: number; label: string; title: string }[] = [];
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    opts.push({
      slot,
      label: `${slotLabel(slot)} — ${blockSummary(slot)}`,
      title: slotLabelVerbose(slot),
    });
  }
  return opts;
});

function onDestChange(e: Event): void {
  const b = block.value;
  const it = item.value;
  if (!b || !it) return;
  const raw = (e.target as HTMLSelectElement).value;
  const newSlot = raw === '' ? null : Number.parseInt(raw, 10);
  if (newSlot !== null && Number.isNaN(newSlot)) return;
  history.execute(
    new SetItemDestinationCommand(b, it, newSlot, rom.activeSlot),
  );
}

async function goToDestination(): Promise<void> {
  const s = destSlot.value;
  if (s === null) return;
  const sourceSlot = rom.activeSlot;
  rom.selectSlot(s);
  // Wait for the active slot watcher (in LevelCanvas) to clear selection
  // on slot change, then highlight the "arrival doors" — entrances in
  // the destination room that point back at `sourceSlot`. If none match
  // (one-way door), selection stays empty and the room still loads.
  await nextTick();
  const destBlock = rom.activeBlock as LevelBlock | null;
  if (!destBlock) return;
  const arrivals = destBlock.items.filter((it) => {
    if (it.kind !== 'entrance' && !ENTERABLE_JAR_IDS.has(it.itemId)) return false;
    return itemDestinationSlot(it) === sourceSlot;
  });
  // Single source of truth: the canvas watches `selectedItems` and
  // handles both paint (selection ring) and scroll-into-view.
  editor.selectedItems = arrivals;
}

function removeDestination(): void {
  const b = block.value;
  const it = item.value;
  if (!b || !it) return;
  history.execute(
    new SetItemDestinationCommand(b, it, null, rom.activeSlot),
  );
}

function deleteItem(): void {
  const b = block.value;
  const it = item.value;
  if (!b || !it) return;
  history.execute(new DeleteItemCommand(b, it, rom.activeSlot));
  editor.selectedItems = [];
}

/** For display: ENTRANCE_ITEM_IDS membership gives us the "Door/Entrance" label. */
const itemKindLabel = computed<string>(() => {
  const it = item.value;
  if (!it) return '';
  if (it.kind === 'entrance' || ENTRANCE_ITEM_IDS.has(it.itemId)) return 'Door / Entrance';
  if (it.kind === 'regular' && ENTERABLE_JAR_IDS.has(it.itemId)) return 'Jar';
  return 'Item';
});
</script>

<template>
  <div
    v-if="item"
    class="p-3 space-y-3"
  >
    <!-- Header: item name + kind + position -->
    <div class="space-y-0.5">
      <div class="text-[10px] uppercase tracking-wide text-ink-muted">
        {{ itemKindLabel }}
      </div>
      <div class="text-sm font-semibold text-ink">
        {{ itemName }}
      </div>
      <div class="text-[10px] font-mono text-ink-muted">
        {{ itemIdHex }} · pos ({{ item.tileX }}, {{ item.tileY }})
      </div>
    </div>

    <!-- Routing section (only for items that can hold a destination) -->
    <div
      v-if="canRoute"
      class="pt-3 border-t border-panel-border space-y-2"
    >
      <div class="text-[10px] uppercase tracking-wide text-ink-muted">
        Routing
        <span
          v-if="isWarpJar"
          class="ml-1 px-1 py-0.5 rounded text-[9px] bg-accent/20 text-accent normal-case tracking-normal"
        >
          warp zone
        </span>
      </div>

      <label class="block">
        <span class="text-[10px] text-ink-muted">Destination room</span>
        <select
          :value="destSlot === null ? '' : destSlot"
          class="mt-0.5 w-full bg-panel border border-panel-border rounded px-2 py-1 text-xs font-mono"
          @change="onDestChange"
        >
          <option value="">
            — no destination —
          </option>
          <option
            v-for="opt in allRoomOptions"
            :key="opt.slot"
            :value="opt.slot"
            :title="opt.title"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <div
        v-if="destSlot !== null"
        class="text-[10px] text-ink-muted leading-snug space-y-0.5"
      >
        <div>
          Entry page: <span class="font-mono">{{ destPage }}</span>
          <span
            v-if="destFar"
            class="ml-1 px-1 py-0.5 rounded text-[9px] bg-ink-muted/20 text-ink-muted"
          >
            far pointer (bank-switched)
          </span>
        </div>
      </div>

      <div
        v-if="destSlot !== null"
        class="flex gap-2"
      >
        <button
          class="flex-1 px-2 py-1 text-xs rounded border border-panel-border bg-panel-subtle hover:bg-panel transition-colors"
          @click="goToDestination"
        >
          Go to {{ slotLabel(destSlot) }} →
        </button>
        <button
          class="px-2 py-1 text-xs rounded border border-panel-border bg-panel-subtle hover:bg-panel transition-colors text-ink-muted"
          @click="removeDestination"
        >
          Clear
        </button>
      </div>
    </div>

    <!-- Destructive action -->
    <div class="pt-3 border-t border-panel-border">
      <button
        class="w-full px-2 py-1 text-xs rounded border border-panel-border bg-panel-subtle hover:bg-red-500/10 hover:text-red-400 transition-colors"
        @click="deleteItem"
      >
        Delete item
      </button>
    </div>
  </div>
</template>
