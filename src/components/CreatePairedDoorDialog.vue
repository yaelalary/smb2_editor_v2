<script setup lang="ts">
/**
 * Modal prompt for the "+ Create paired door…" action in the Item
 * Inspector. Collects:
 *   - destination room (slot, 0..209)
 *   - destination page (0..9, occupied pages disabled)
 *   - paired door type (entrance item id)
 *
 * Emits `confirm` with the three values. The caller executes
 * `CreatePairedDoorCommand` which places a new entrance at the
 * computed spawn tile and wires up the bytes reciprocally.
 */
import { ref, computed, watch, onMounted, onUnmounted, toRaw } from 'vue';
import BaseButton from './common/BaseButton.vue';
import { useRomStore } from '@/stores/rom';
import { slotLabel, slotLabelVerbose, slotWorld, slotLevel } from '@/rom/level-layout';
import { MAX_LEVELS, ENTRANCE_ITEM_IDS } from '@/rom/constants';
import { ITEM_NAMES } from '@/rom/nesleveldef';
import { isRoutingItem, tilePageOf } from '@/commands/routing-commands';
import type { LevelBlock, LevelMap } from '@/rom/model';

const props = defineProps<{
  open: boolean;
  /** Current slot — excluded from the target room dropdown so the user
   *  doesn't accidentally create a pair inside the same room. */
  currentSlot: number;
}>();

const emit = defineEmits<{
  confirm: [payload: { destSlot: number; destPage: number; doorId: number }];
  cancel: [];
}>();

const rom = useRomStore();
const dialogRef = ref<HTMLDialogElement | null>(null);

const destSlot = ref<number | null>(null);
const destPage = ref<number | null>(null);
// Default: Door (0x0A) — the most common type.
const doorId = ref<number>(0x0a);

// Rooms in the same level within the same world (e.g. 1-1·X only) —
// SMB2 corrupts cross-world or cross-level routing (each world carries
// its own tile/palette/music set and each level its own enemy stream,
// none reloaded mid-traversal). Current zone excluded too.
interface RoomOption {
  slot: number;
  label: string;
  title: string;
}
const sameLevelRooms = computed<RoomOption[]>(() => {
  const map = rom.levelMap;
  if (!map) return [];
  const world = slotWorld(props.currentSlot);
  const level = slotLevel(props.currentSlot);
  const rooms: RoomOption[] = [];
  for (let slot = 0; slot < MAX_LEVELS; slot++) {
    if (slot === props.currentSlot) continue;
    if (slotWorld(slot) !== world) continue;
    if (slotLevel(slot) !== level) continue;
    if (map.slotToBlock[slot] === undefined) continue;
    rooms.push({
      slot,
      label: slotLabel(slot),
      title: slotLabelVerbose(slot),
    });
  }
  return rooms;
});

/** Pages already occupied by an entrance/pointer in the destination
 *  room — SMB2 allows at most one per page. */
const occupiedPages = computed<Set<number>>(() => {
  const map = rom.levelMap;
  const slot = destSlot.value;
  if (!map || slot === null) return new Set();
  const rawMap = toRaw(map);
  const blockIndex = rawMap.slotToBlock[slot];
  if (blockIndex === undefined) return new Set();
  const block = toRaw(rawMap.blocks[blockIndex]);
  if (!block) return new Set();
  const pages = new Set<number>();
  for (const item of block.items) {
    if (!isRoutingItem(item as unknown as import('@/rom/model').LevelItem)) continue;
    pages.add(tilePageOf(item as unknown as import('@/rom/model').LevelItem, block as LevelBlock));
  }
  return pages;
});

/** Total number of pages allowed by the destination room's header. */
const destPageCount = computed<number>(() => {
  const map = rom.levelMap;
  const slot = destSlot.value;
  if (!map || slot === null) return 0;
  const rawMap = toRaw(map);
  const blockIndex = rawMap.slotToBlock[slot];
  if (blockIndex === undefined) return 0;
  const block = rawMap.blocks[blockIndex] as LevelBlock | undefined;
  if (!block) return 0;
  // SMB2 allows up to 10 pages per level; the header's `length` encodes
  // the count minus 1. Cap at 10.
  return Math.min(10, (block.header.length ?? 0) + 1);
});

const availablePages = computed<{ page: number; disabled: boolean }[]>(() => {
  const count = destPageCount.value;
  const occ = occupiedPages.value;
  const out: { page: number; disabled: boolean }[] = [];
  for (let p = 0; p < count; p++) out.push({ page: p, disabled: occ.has(p) });
  return out;
});

/** Choices for the paired door's visual/mechanical type. */
const doorTypeOptions = computed<{ id: number; label: string }[]>(() => {
  const ids = Array.from(ENTRANCE_ITEM_IDS).sort((a, b) => a - b);
  return ids.map((id) => ({ id, label: ITEM_NAMES[id] ?? `#${id}` }));
});

const canConfirm = computed<boolean>(() => {
  return destSlot.value !== null
    && destPage.value !== null
    && !occupiedPages.value.has(destPage.value)
    && doorId.value > 0;
});

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      // Reset to clean state each time we open.
      destSlot.value = null;
      destPage.value = null;
      doorId.value = 0x0a;
      dialogRef.value?.showModal();
    } else {
      dialogRef.value?.close();
    }
  },
);

// Invalidate page selection when slot changes (page count / occupied differ).
watch(destSlot, () => {
  destPage.value = null;
});

function onCancel(): void {
  emit('cancel');
}

function onConfirm(): void {
  const s = destSlot.value;
  const p = destPage.value;
  if (s === null || p === null) return;
  emit('confirm', { destSlot: s, destPage: p, doorId: doorId.value });
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) {
    e.preventDefault();
    onCancel();
  }
}

function onBackdropClick(e: MouseEvent): void {
  if (e.target === dialogRef.value) onCancel();
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <dialog
    ref="dialogRef"
    class="fixed inset-0 z-50 m-auto rounded-lg border border-panel-border bg-panel
           shadow-xl backdrop:bg-black/40 p-0 max-w-sm w-full"
    @click="onBackdropClick"
  >
    <div class="p-5 space-y-4">
      <h2 class="text-sm font-semibold text-ink">
        Create paired door
      </h2>
      <p class="text-[11px] text-ink-muted leading-snug">
        A new door will be placed in the target room at the exact tile where Mario emerges — so the round-trip works both ways.
      </p>

      <label class="block space-y-1">
        <span class="text-[10px] text-ink-muted">Destination room (same level only)</span>
        <select
          :value="destSlot ?? ''"
          class="w-full bg-panel-subtle border border-panel-border rounded px-2 py-1 text-xs font-mono"
          @change="(e) => { const v = (e.target as HTMLSelectElement).value; destSlot = v === '' ? null : Number.parseInt(v, 10); }"
        >
          <option value="">
            — pick a room —
          </option>
          <option
            v-for="r in sameLevelRooms"
            :key="r.slot"
            :value="r.slot"
            :title="r.title"
          >
            {{ r.label }}
          </option>
        </select>
      </label>

      <label
        v-if="destSlot !== null"
        class="block space-y-1"
      >
        <span class="text-[10px] text-ink-muted">Destination page</span>
        <select
          :value="destPage ?? ''"
          class="w-full bg-panel-subtle border border-panel-border rounded px-2 py-1 text-xs font-mono"
          @change="(e) => { const v = (e.target as HTMLSelectElement).value; destPage = v === '' ? null : Number.parseInt(v, 10); }"
        >
          <option value="">
            — pick a page —
          </option>
          <option
            v-for="p in availablePages"
            :key="p.page"
            :value="p.page"
            :disabled="p.disabled"
          >
            Page {{ p.page }}{{ p.disabled ? ' (already occupied)' : '' }}
          </option>
        </select>
      </label>

      <label class="block space-y-1">
        <span class="text-[10px] text-ink-muted">Paired door type</span>
        <select
          :value="doorId"
          class="w-full bg-panel-subtle border border-panel-border rounded px-2 py-1 text-xs"
          @change="(e) => { doorId = Number.parseInt((e.target as HTMLSelectElement).value, 10); }"
        >
          <option
            v-for="opt in doorTypeOptions"
            :key="opt.id"
            :value="opt.id"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <div class="flex justify-end gap-3 pt-2">
        <BaseButton
          variant="secondary"
          size="sm"
          @click="onCancel"
        >
          Cancel
        </BaseButton>
        <BaseButton
          variant="primary"
          size="sm"
          :disabled="!canConfirm"
          @click="onConfirm"
        >
          Create
        </BaseButton>
      </div>
    </div>
  </dialog>
</template>
