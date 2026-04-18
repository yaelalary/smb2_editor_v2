<script setup lang="ts">
/**
 * Left sidebar: scrollable list of all 210 level slots. Clicking a
 * slot selects it, which drives the canvas view and the properties
 * panel (Unit 8+).
 *
 * Each row shows: W:L label, level-block header summary (direction +
 * length), item count, and byte size. Shared blocks are marked with
 * the sharing count so the user notices the relationship.
 */
import { computed } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { useRomStore } from '@/stores/rom';
import { MAX_LEVELS } from '@/rom/constants';
import { slotLabel, slotLabelVerbose } from '@/rom/level-layout';

const rom = useRomStore();

const slots = computed(() => {
  const lm = rom.levelMap;
  if (!lm) return [];
  return Array.from({ length: MAX_LEVELS }, (_, i) => {
    const blockIdx = lm.slotToBlock[i]!;
    const block = lm.blocks[blockIdx]!;
    return {
      slot: i,
      blockIdx,
      label: slotLabel(i),
      title: slotLabelVerbose(i),
      direction: block.header.direction === 1 ? 'H' : 'V',
      length: block.header.length + 1,
      items: block.items.length,
      bytes: block.byteLength,
      shared: block.referencingSlots.length > 1,
      sharingCount: block.referencingSlots.length,
    };
  });
});
</script>

<template>
  <BasePanel title="Levels">
    <div class="divide-y divide-panel-border">
      <button
        v-for="s in slots"
        :key="s.slot"
        :class="[
          'w-full text-left px-3 py-1.5 text-xs font-mono transition-colors',
          'hover:bg-panel-subtle focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          rom.activeSlot === s.slot
            ? 'bg-accent/10 text-ink font-semibold'
            : 'text-ink-muted',
        ]"
        :title="s.title"
        @click="rom.selectSlot(s.slot)"
      >
        <span class="inline-block w-16">{{ s.label }}</span>
        <span class="inline-block w-6 text-center">{{ s.direction }}</span>
        <span class="inline-block w-8 text-right">{{ s.length }}p</span>
        <span class="inline-block w-10 text-right">{{ s.items }}i</span>
        <span class="inline-block w-12 text-right">{{ s.bytes }}B</span>
        <span
          v-if="s.shared"
          class="ml-1 text-status-warn"
          :title="`Shared with ${s.sharingCount} slots`"
        >×{{ s.sharingCount }}</span>
      </button>
    </div>
  </BasePanel>
</template>
