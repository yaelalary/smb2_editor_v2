<script setup lang="ts">
/**
 * Dev tool — visual diagnostic for the level parser.
 *
 * Not part of the shipping app. Accessed via `?dev=levels`. Self-
 * contained: has its own ROM loader so it doesn't depend on any main-
 * flow state. Safe to delete once Unit 6's real level viewer lands.
 *
 * Three views:
 *   1. Summary: slot/block counts, sharing ratio, region byte usage.
 *   2. Slot table: all 210 slots → block idx + decoded header.
 *   3. Block detail: source bytes, item list with kind + raw bytes.
 *
 * A parser crash lands as a visible error banner here so bugs surface
 * quickly during development without needing to open the test runner.
 */
import { computed, ref, shallowRef } from 'vue';
import BasePanel from '@/components/common/BasePanel.vue';
import BaseButton from '@/components/common/BaseButton.vue';
import RomLoader from '@/components/RomLoader.vue';
import type { ValidationSuccess } from '@/rom/validation';
import type { LevelBlock, LevelMap } from '@/rom/model';
import { parseLevelMap, LevelParseError } from '@/rom/level-parser';
import { LEVEL_REGION_BYTES } from '@/rom/constants';

const loadedRom = shallowRef<ValidationSuccess | null>(null);
const parseError = ref<string | null>(null);
const levelMap = shallowRef<LevelMap | null>(null);
const selectedSlot = ref<number>(0);

function onLoaded(rom: ValidationSuccess): void {
  loadedRom.value = rom;
  parseError.value = null;
  try {
    levelMap.value = parseLevelMap(rom.rom);
    selectedSlot.value = 0;
  } catch (err) {
    const message =
      err instanceof LevelParseError
        ? err.message
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : String(err);
    parseError.value = message;
    levelMap.value = null;
  }
}

const selectedBlock = computed<LevelBlock | null>(() => {
  const map = levelMap.value;
  if (!map) return null;
  const blockIdx = map.slotToBlock[selectedSlot.value];
  if (blockIdx === undefined) return null;
  return map.blocks[blockIdx] ?? null;
});

const sharingStats = computed(() => {
  const map = levelMap.value;
  if (!map) return null;
  const sharedBlocks = map.blocks.filter((b) => b.referencingSlots.length > 1);
  const totalBytes = map.blocks.reduce((acc, b) => acc + b.byteLength, 0);
  return {
    totalSlots: map.slotToBlock.length,
    uniqueBlocks: map.blocks.length,
    sharedBlocks: sharedBlocks.length,
    totalBytes,
    maxSharing: Math.max(
      1,
      ...map.blocks.map((b) => b.referencingSlots.length),
    ),
  };
});

/**
 * Format an SMB2 slot index as "W-L" where possible (worlds 1-7 ×
 * levels 1-3 plus warp zones). Matches the vanilla game's 21
 * playable rooms, mirroring the 21-byte "starts" sub-table — but
 * the debug view just shows the raw slot index for indices the
 * shorthand doesn't cover.
 */
function slotLabel(slot: number): string {
  // First 7 worlds × 3 levels = slots 0..20 (rough mapping; the real
  // ROM layout is more nuanced but this is a debug view, not a player
  // guide). Fall back to hex for higher indices.
  if (slot < 21) {
    const world = Math.floor(slot / 3) + 1;
    const level = (slot % 3) + 1;
    return `${world}-${level}`;
  }
  return `#${slot}`;
}

function hex(n: number, width = 2): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => hex(b)).join(' ');
}

function resetRom(): void {
  loadedRom.value = null;
  levelMap.value = null;
  parseError.value = null;
}
</script>

<template>
  <main class="min-h-screen p-6 max-w-screen-2xl mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-bold mb-1">
        Level Parser Debug
      </h1>
      <p class="text-sm text-ink-muted">
        Parses all 210 slots of the loaded ROM and shows how they map to
        physical level blocks. The ROM and parse results stay in memory
        only.
      </p>
    </header>

    <div
      v-if="!loadedRom"
      class="flex items-center justify-center py-12"
    >
      <RomLoader @loaded="onLoaded" />
    </div>

    <div
      v-else-if="parseError"
      class="max-w-xl mx-auto space-y-3"
    >
      <BasePanel title="Parse error">
        <div class="p-4 space-y-3">
          <p class="text-status-danger font-mono text-sm break-all">
            {{ parseError }}
          </p>
          <BaseButton
            variant="secondary"
            size="sm"
            @click="resetRom"
          >
            Load another ROM
          </BaseButton>
        </div>
      </BasePanel>
    </div>

    <div
      v-else-if="levelMap && sharingStats"
      class="grid grid-cols-[2fr_3fr] gap-4 h-[calc(100vh-8rem)]"
    >
      <!-- Left: summary + slot table -->
      <div class="flex flex-col gap-4 min-h-0">
        <BasePanel
          title="Summary"
          :no-scroll="true"
        >
          <dl class="p-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt class="text-ink-muted">
              Slots
            </dt>
            <dd class="font-mono">
              {{ sharingStats.totalSlots }}
            </dd>
            <dt class="text-ink-muted">
              Unique blocks
            </dt>
            <dd class="font-mono">
              {{ sharingStats.uniqueBlocks }}
            </dd>
            <dt class="text-ink-muted">
              Shared blocks
            </dt>
            <dd class="font-mono">
              {{ sharingStats.sharedBlocks }}
              (max {{ sharingStats.maxSharing }} slots/block)
            </dd>
            <dt class="text-ink-muted">
              Data size
            </dt>
            <dd class="font-mono">
              {{ sharingStats.totalBytes }} /
              {{ LEVEL_REGION_BYTES }} bytes
              ({{ Math.round(
                (sharingStats.totalBytes / LEVEL_REGION_BYTES) * 100,
              ) }}%)
            </dd>
          </dl>
          <div class="px-4 pb-3">
            <BaseButton
              variant="secondary"
              size="sm"
              @click="resetRom"
            >
              Load another ROM
            </BaseButton>
          </div>
        </BasePanel>

        <BasePanel
          title="Slots → blocks"
          class="min-h-0 flex-1"
        >
          <table class="w-full text-xs font-mono">
            <thead class="sticky top-0 bg-panel-subtle text-ink-muted">
              <tr>
                <th class="text-left px-3 py-2">
                  Slot
                </th>
                <th class="text-left px-3 py-2">
                  Block
                </th>
                <th class="text-left px-3 py-2">
                  Header bytes
                </th>
                <th class="text-left px-3 py-2">
                  Items
                </th>
                <th class="text-left px-3 py-2">
                  Size
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(blockIdx, slot) in levelMap.slotToBlock"
                :key="slot"
                :class="[
                  'cursor-pointer hover:bg-panel-subtle',
                  selectedSlot === slot ? 'bg-accent/10' : '',
                ]"
                @click="selectedSlot = slot"
              >
                <td class="px-3 py-1">
                  {{ slotLabel(slot) }}
                  <span class="text-ink-muted">({{ slot }})</span>
                </td>
                <td class="px-3 py-1">
                  #{{ blockIdx }}
                </td>
                <td class="px-3 py-1">
                  {{ bytesToHex(levelMap.blocks[blockIdx]!.header.sourceBytes) }}
                </td>
                <td class="px-3 py-1">
                  {{ levelMap.blocks[blockIdx]!.items.length }}
                </td>
                <td class="px-3 py-1">
                  {{ levelMap.blocks[blockIdx]!.byteLength }}B
                </td>
              </tr>
            </tbody>
          </table>
        </BasePanel>
      </div>

      <!-- Right: selected block details -->
      <BasePanel
        v-if="selectedBlock"
        :title="`Block #${levelMap.slotToBlock[selectedSlot]} — slot ${slotLabel(selectedSlot)}`"
        class="min-h-0"
      >
        <div class="p-4 space-y-4 text-sm">
          <section>
            <h3 class="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Header
            </h3>
            <div class="font-mono text-xs bg-panel-subtle rounded p-2 mb-2">
              {{ bytesToHex(selectedBlock.header.sourceBytes) }}
            </div>
            <dl class="grid grid-cols-2 gap-x-4 gap-y-0.5">
              <dt class="text-ink-muted">
                Direction
              </dt>
              <dd>
                {{ selectedBlock.header.direction === 1 ? 'horizontal' : 'vertical' }}
              </dd>
              <dt class="text-ink-muted">
                Palette
              </dt>
              <dd>{{ selectedBlock.header.palette }}</dd>
              <dt class="text-ink-muted">
                Enemy color
              </dt>
              <dd>{{ selectedBlock.header.enemyColor }}</dd>
              <dt class="text-ink-muted">
                Ground set
              </dt>
              <dd>{{ selectedBlock.header.groundSet }}</dd>
              <dt class="text-ink-muted">
                Ground type
              </dt>
              <dd>{{ selectedBlock.header.groundType }}</dd>
              <dt class="text-ink-muted">
                Object type
              </dt>
              <dd>{{ selectedBlock.header.objectType }}</dd>
              <dt class="text-ink-muted">
                Length
              </dt>
              <dd>{{ selectedBlock.header.length }} pages</dd>
              <dt class="text-ink-muted">
                Music
              </dt>
              <dd>{{ selectedBlock.header.music }}</dd>
              <dt class="text-ink-muted">
                Reserved bits
              </dt>
              <dd class="font-mono">
                0x{{ hex(selectedBlock.header.reservedBits) }}
              </dd>
            </dl>
          </section>

          <section>
            <h3 class="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Referencing slots ({{ selectedBlock.referencingSlots.length }})
            </h3>
            <p class="text-xs font-mono">
              {{ selectedBlock.referencingSlots.map(s => slotLabel(s)).join(', ') }}
            </p>
          </section>

          <section>
            <h3 class="text-xs uppercase tracking-wide text-ink-muted mb-2">
              Items ({{ selectedBlock.items.length }})
            </h3>
            <table class="w-full text-xs font-mono">
              <thead class="text-ink-muted">
                <tr>
                  <th class="text-left py-1">
                    #
                  </th>
                  <th class="text-left py-1">
                    Kind
                  </th>
                  <th class="text-left py-1">
                    Bytes
                  </th>
                  <th class="text-left py-1">
                    ROM offset
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(item, idx) in selectedBlock.items"
                  :key="idx"
                  class="border-t border-panel-border"
                >
                  <td class="py-1 pr-2 text-ink-muted">
                    {{ idx }}
                  </td>
                  <td class="py-1 pr-2">
                    {{ item.kind }}
                  </td>
                  <td class="py-1 pr-2">
                    {{ bytesToHex(item.sourceBytes) }}
                  </td>
                  <td class="py-1 pr-2 text-ink-muted">
                    0x{{ hex(item.sourceRange[0], 5) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </BasePanel>
    </div>
  </main>
</template>
