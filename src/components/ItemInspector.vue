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
import { computed, nextTick, ref, toRaw } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { ITEM_NAMES } from '@/rom/nesleveldef';
import { slotLabel, slotLabelVerbose, slotWorld, slotLevel } from '@/rom/level-layout';
import { MAX_LEVELS, ENTRANCE_ITEM_IDS, ENTERABLE_JAR_IDS } from '@/rom/constants';
import {
  itemDestination,
  findBackPointer,
  isRoutingItem,
  tilePageOf,
  computeSpawnPosition,
  PairItemsCommand,
  CreatePairedDoorCommand,
} from '@/commands/routing-commands';
import { DeleteItemCommand, MoveItemCommand } from '@/commands/tile-commands';
import type { LevelBlock, LevelItem, LevelMap } from '@/rom/model';
import CreatePairedDoorDialog from './CreatePairedDoorDialog.vue';

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

/**
 * Where Mario will actually spawn in the destination room, per SMB2's
 * runtime formula. Null when there's no destination.
 *
 * The game computes this from A's own position — the paired door's
 * position isn't used. Surfacing it lets the user notice when the
 * spawn point falls off the paired door and move doors accordingly.
 */
const spawnPosition = computed<{ tileX: number; tileY: number } | null>(() => {
  void history.revision;
  const it = item.value;
  const dest = decodedDest.value;
  const levelMap = rom.levelMap;
  if (!it || !dest || !levelMap) return null;
  const destBlockIndex = levelMap.slotToBlock[dest.slot];
  if (destBlockIndex === undefined) return null;
  const destBlock = toRaw(levelMap.blocks[destBlockIndex]);
  if (!destBlock) return null;
  return computeSpawnPosition(it, destBlock as LevelBlock, dest.page);
});

/** True when Mario's spawn lands exactly on the paired door. */
const spawnMatchesPair = computed<boolean>(() => {
  const bp = backPointer.value;
  const sp = spawnPosition.value;
  if (!bp || !sp) return false;
  return bp.tileX === sp.tileX && bp.tileY === sp.tileY;
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
 * Scoped to the **same level within the same world** (e.g. 1-1·X doors
 * only link to other 1-1·X rooms). Cross-level or cross-world linking
 * corrupts the ROM: each world carries its own palette/music/tile set
 * and each level its own enemy stream, none of which are reloaded
 * when the runtime crosses those boundaries. The current slot itself
 * is excluded so the user can't pair with a door in the same zone.
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
  const currentWorld = slotWorld(rom.activeSlot);
  const currentLevel = slotLevel(rom.activeSlot);
  const groups: DoorGroup[] = [];
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    if (slot === rom.activeSlot) continue; // no same-zone linking
    if (slotWorld(slot) !== currentWorld) continue;
    if (slotLevel(slot) !== currentLevel) continue;
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

/** Modal state for "+ Create paired door…". */
const createPairedOpen = ref(false);

function onCreatePairedConfirm(payload: { destSlot: number; destPage: number; doorId: number }): void {
  const b = block.value;
  const it = item.value;
  const levelMap = rom.levelMap;
  if (!b || !it || !levelMap) {
    createPairedOpen.value = false;
    return;
  }
  const rawMap = toRaw(levelMap);
  const blockIndex = rawMap.slotToBlock[payload.destSlot];
  if (blockIndex === undefined) {
    createPairedOpen.value = false;
    return;
  }
  const destBlock = toRaw(rawMap.blocks[blockIndex]) as LevelBlock | undefined;
  if (!destBlock) {
    createPairedOpen.value = false;
    return;
  }
  history.execute(
    new CreatePairedDoorCommand(
      b, it, rom.activeSlot,
      destBlock, payload.destSlot, payload.destPage, payload.doorId,
      rom.activeSlot,
    ),
  );
  createPairedOpen.value = false;
}

/**
 * Move the currently-paired door to the position Mario will actually
 * spawn on. Called from the warning's "Align" button. The pair has
 * already been wired up (bytes OK); we just snap the partner's tile.
 */
function alignLinkedDoor(): void {
  const bp = backPointer.value;
  const sp = spawnPosition.value;
  const dest = decodedDest.value;
  const levelMap = rom.levelMap;
  if (!bp || !sp || !dest || !levelMap) return;
  const rawMap = toRaw(levelMap);
  const blockIndex = rawMap.slotToBlock[dest.slot];
  if (blockIndex === undefined) return;
  const destBlock = toRaw(rawMap.blocks[blockIndex]);
  if (!destBlock) return;
  history.execute(
    new MoveItemCommand(
      destBlock as LevelBlock,
      toRaw(bp),
      sp.tileX,
      sp.tileY,
      dest.slot,
    ),
  );
}

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

      <!-- Create a new paired door in a target room — C++ tool's
           "Create connected door" flow. Places the new door at the
           computed spawn tile so Mario lands on it. -->
      <button
        class="w-full px-2 py-1 text-[10px] rounded border border-panel-border bg-panel-subtle hover:bg-panel text-ink-muted hover:text-ink transition-colors"
        @click="createPairedOpen = true"
      >
        + Create paired door…
      </button>

      <!-- Spawn position mismatch warning. The "Mario will arrive at"
           line is noise when the pair is already clean, so we only
           surface it when the linked door isn't at the spawn tile or
           the source is orphan — i.e. when there's something to fix. -->
      <div
        v-if="spawnPosition && destSlot !== null && !spawnMatchesPair"
        class="text-[10px] text-ink-muted leading-snug space-y-1"
      >
        <div>
          Mario will arrive at ({{ spawnPosition.tileX }}, {{ spawnPosition.tileY }}) in {{ slotLabel(destSlot) }}.
        </div>
        <template v-if="backPointer">
          <div class="text-amber-400">
            ⚠ The linked door is at ({{ backPointer.tileX }}, {{ backPointer.tileY }}) — move a door so the positions match.
          </div>
          <button
            class="w-full px-2 py-1 text-[10px] rounded border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 text-amber-300 transition-colors"
            @click="alignLinkedDoor"
          >
            Align linked door to ({{ spawnPosition.tileX }}, {{ spawnPosition.tileY }})
          </button>
        </template>
      </div>

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

    <CreatePairedDoorDialog
      :open="createPairedOpen"
      :current-slot="rom.activeSlot"
      @confirm="onCreatePairedConfirm"
      @cancel="createPairedOpen = false"
    />
  </div>
</template>
