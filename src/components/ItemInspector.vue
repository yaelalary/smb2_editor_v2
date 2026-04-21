<script setup lang="ts">
/**
 * Item Inspector — right-panel view shown when exactly one item is
 * selected on the canvas. Main job: editing the routing pair of a
 * door / enterable jar, flagging orphan state when a pair is broken,
 * and deleting items.
 *
 * Pairing is always bidirectional. Picking a new target updates BOTH
 * sides at once; whatever was previously on either end becomes orphan
 * automatically (it still points here, but we no longer point back).
 * `buildOrphanIndex` detects those orphans and the canvas flags them.
 */
import { computed, nextTick, toRaw } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { ITEM_NAMES } from '@/rom/nesleveldef';
import { slotLabel, slotLabelVerbose } from '@/rom/level-layout';
import { MAX_LEVELS, ENTRANCE_ITEM_IDS, ENTERABLE_JAR_IDS } from '@/rom/constants';
import {
  itemDestination,
  findBackPointer,
  isRoutingItem,
  tilePageOf,
  PairItemsCommand,
} from '@/commands/routing-commands';
import { DeleteItemCommand } from '@/commands/tile-commands';
import type { LevelBlock, LevelItem, LevelMap } from '@/rom/model';

/** Jar ids used as warp zones (can target multiple destinations). */
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
  return ITEM_NAMES[it.itemId] ?? `Item #${it.itemId}`;
});

const canRoute = computed<boolean>(() => {
  const it = item.value;
  return !!it && isRoutingItem(it);
});

const isWarpJar = computed<boolean>(() => {
  const it = item.value;
  return !!it && WARP_JAR_IDS.has(it.itemId);
});

const decodedDest = computed(() => {
  // PairItemsCommand mutates sourceBytes in place → the LevelItem ref
  // is unchanged, so Vue would short-circuit this computed. Touching
  // history.revision forces a recompute after every command.
  void history.revision;
  const it = item.value;
  return it ? itemDestination(it) : null;
});

const destSlot = computed<number | null>(() => decodedDest.value?.slot ?? null);

/** The paired door in the destination room, or null (→ orphan). */
const backPointer = computed<LevelItem | null>(() => {
  void history.revision;
  const it = item.value;
  const b = block.value;
  const dest = decodedDest.value;
  const levelMap = rom.levelMap;
  if (!it || !b || !dest || !levelMap) return null;
  // Strict pair: the partner must sit at dest.page AND point back to
  // (our slot, our page). Without the full page check, any door in
  // dest.slot that merely happens to point to our slot looks like a
  // pair — including orphans left by a prior re-pair.
  const sourcePage = tilePageOf(it, b);
  return findBackPointer(
    toRaw(levelMap) as LevelMap,
    rom.activeSlot,
    sourcePage,
    dest.slot,
    dest.page,
  );
});

/** One of: paired / orphan / unpaired. Drives the UI variant. */
const pairState = computed<'paired' | 'orphan' | 'unpaired'>(() => {
  if (destSlot.value === null) return 'unpaired';
  return backPointer.value ? 'paired' : 'orphan';
});

/** Human label for any routing item — used in the picker option text. */
function doorLabel(it: LevelItem): string {
  const kind = ENTRANCE_ITEM_IDS.has(it.itemId) ? 'Door' : 'Jar';
  return `${kind} at (${it.tileX}, ${it.tileY})`;
}

interface DoorOption {
  slot: number;
  block: LevelBlock;
  item: LevelItem;
  key: string;
  label: string;
}
interface DoorGroup {
  slot: number;
  label: string;
  title: string;
  doors: DoorOption[];
}

/**
 * All routing items in the ROM, grouped by their room.
 *
 * `rom.levelMap` is exposed as `readonly()` from the store — nested
 * accesses return readonly proxies that refuse writes. We unwrap via
 * `toRaw` at each level so the items/blocks pushed into the options
 * are the real mutable objects. `PairItemsCommand` writes to them
 * directly, and identity matches `rom.activeBlock`'s items (so orphan
 * detection on the canvas finds the same references).
 */
const pickerGroups = computed<DoorGroup[]>(() => {
  void history.revision;
  const current = item.value;
  const map = rom.levelMap;
  if (!map) return [];
  const rawMap = toRaw(map);
  const groups: DoorGroup[] = [];
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    const blockIndex = rawMap.slotToBlock[slot];
    if (blockIndex === undefined) continue;
    const rawBlock = toRaw(rawMap.blocks[blockIndex]);
    if (!rawBlock) continue;
    const doors: DoorOption[] = [];
    for (let i = 0; i < rawBlock.items.length; i++) {
      const rawItem = toRaw(rawBlock.items[i])!;
      if (!isRoutingItem(rawItem)) continue;
      if (rawItem === current) continue; // can't pair with self
      doors.push({
        slot,
        block: rawBlock as LevelBlock,
        item: rawItem,
        key: `${slot}:${i}`,
        label: doorLabel(rawItem),
      });
    }
    if (doors.length === 0) continue;
    groups.push({
      slot,
      label: slotLabel(slot),
      title: slotLabelVerbose(slot),
      doors,
    });
  }
  return groups;
});

/** key → DoorOption lookup, for O(1) resolution on <select> change. */
const pickerIndex = computed<Map<string, DoorOption>>(() => {
  const idx = new Map<string, DoorOption>();
  for (const g of pickerGroups.value) {
    for (const d of g.doors) idx.set(d.key, d);
  }
  return idx;
});

/**
 * Key of the door we're currently paired with, bound to the <select>.
 * Empty string when unpaired or orphan (no back-pointer resolvable to
 * a picker option). After a PairItemsCommand runs, this recomputes via
 * `backPointer` → the dropdown reflects the new pair automatically.
 */
const currentPairKey = computed<string>(() => {
  const bp = backPointer.value;
  const ds = destSlot.value;
  const levelMap = rom.levelMap;
  if (!bp || ds === null || !levelMap) return '';
  const rawMap = toRaw(levelMap);
  const blockIndex = rawMap.slotToBlock[ds];
  if (blockIndex === undefined) return '';
  const destBlock = toRaw(rawMap.blocks[blockIndex]);
  if (!destBlock) return '';
  const idx = destBlock.items.indexOf(toRaw(bp));
  return idx >= 0 ? `${ds}:${idx}` : '';
});

function onPickerChange(e: Event): void {
  const b = block.value;
  const it = item.value;
  if (!b || !it) return;
  const key = (e.target as HTMLSelectElement).value;
  if (!key) return;
  const opt = pickerIndex.value.get(key);
  if (!opt) return;
  history.execute(
    new PairItemsCommand(
      b, it, rom.activeSlot,
      opt.block, opt.item, opt.slot,
      rom.activeSlot,
    ),
  );
}

async function goToDestination(): Promise<void> {
  const it = item.value;
  const b = block.value;
  const dest = decodedDest.value;
  if (!it || !b || !dest) return;
  const sourceSlot = rom.activeSlot;
  const sourcePage = tilePageOf(it, b);
  rom.selectSlot(dest.slot);
  await nextTick();
  const levelMap = rom.levelMap;
  if (!levelMap) return;
  // Strict pair lookup: ignores orphan leftovers pointing back to us.
  const pair = findBackPointer(
    toRaw(levelMap) as LevelMap,
    sourceSlot,
    sourcePage,
    dest.slot,
    dest.page,
  );
  editor.selectedItems = pair ? [pair] : [];
}

function deleteItem(): void {
  const b = block.value;
  const it = item.value;
  if (!b || !it) return;
  history.execute(new DeleteItemCommand(b, it, rom.activeSlot));
  editor.selectedItems = [];
}

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
    <!-- Header -->
    <div class="space-y-0.5">
      <div class="text-[10px] uppercase tracking-wide text-ink-muted">
        {{ itemKindLabel }}
      </div>
      <div class="text-sm font-semibold text-ink">
        {{ itemName }}
      </div>
      <div class="text-[10px] text-ink-muted">
        Position ({{ item.tileX }}, {{ item.tileY }})
      </div>
    </div>

    <!-- Routing section -->
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

      <!-- Warning banners. Orphan gets the long explanation (dangerous,
           produces a crashy ROM). Unpaired is neutral — short note. -->
      <div
        v-if="pairState === 'orphan'"
        class="text-[10px] font-semibold text-red-400 leading-snug"
      >
        ⚠ One-way link — points to {{ destSlot !== null ? slotLabel(destSlot) : '' }} but nothing there comes back. Likely soft-locks the game.
      </div>
      <div
        v-else-if="pairState === 'unpaired'"
        class="text-[10px] text-ink-muted leading-snug"
      >
        This door is not linked.
      </div>

      <!-- Paired door picker. Value binds to the current pair → selecting
           another door triggers PairItemsCommand, and the computed
           re-resolves to the new pair on its own. -->
      <select
        :value="currentPairKey"
        class="w-full bg-panel border border-panel-border rounded px-2 py-1 text-xs font-mono"
        @change="onPickerChange"
      >
        <option value="">
          — not linked —
        </option>
        <optgroup
          v-for="g in pickerGroups"
          :key="g.slot"
          :label="g.label"
          :title="g.title"
        >
          <option
            v-for="d in g.doors"
            :key="d.key"
            :value="d.key"
          >
            {{ d.label }}
          </option>
        </optgroup>
      </select>

      <!-- Go to destination. Disabled (not hidden) when unpaired so the
           user still sees the affordance but can't act on nothing. -->
      <div class="flex">
        <button
          :disabled="destSlot === null"
          class="flex-1 px-2 py-1 text-xs rounded border border-panel-border bg-panel-subtle hover:bg-panel transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-panel-subtle"
          @click="goToDestination"
        >
          Go to destination →
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
