<script setup lang="ts">
/**
 * Banner shown above the canvas when the active slot's enemy block is
 * shared with other slots. Explains the sharing in natural language
 * and offers a "Make independent" button.
 */
import { computed } from 'vue';
import BaseButton from './common/BaseButton.vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { DetachEnemyBlockCommand } from '@/commands/detach-enemy-command';
import { LEVELS_PER_WORLD } from '@/rom/constants';
import type { EnemyBlock } from '@/rom/model';

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();

function slotLabel(slot: number): string {
  const w = Math.floor(slot / LEVELS_PER_WORLD);
  const l = slot % LEVELS_PER_WORLD;
  return `W${w}:L${l}`;
}

const enemyBlock = computed<EnemyBlock | null>(() => {
  void history.revision;
  const map = rom.enemyMap;
  if (!map) return null;
  const idx = map.slotToBlock[rom.activeSlot];
  if (idx === undefined) return null;
  return (map.blocks[idx] as EnemyBlock) ?? null;
});

const isShared = computed(() => {
  const block = enemyBlock.value;
  return block ? block.referencingSlots.length > 1 : false;
});

const sharedWith = computed(() => {
  const block = enemyBlock.value;
  if (!block) return [];
  return block.referencingSlots
    .filter((s) => s !== rom.activeSlot)
    .map(slotLabel);
});

const isVisible = computed(() => {
  return isShared.value && editor.activeTool === 'enemies';
});

function detach(): void {
  const map = rom.enemyMap;
  if (!map) return;
  // Cast strips Pinia's DeepReadonly — the command needs mutable access.
  history.execute(
    new DetachEnemyBlockCommand(
      map as unknown as import('@/rom/model').EnemyMap,
      rom.activeSlot,
    ),
  );
}
</script>

<template>
  <div
    v-if="isVisible"
    class="flex items-center gap-3 px-4 py-2 bg-status-warn/10 border-b border-status-warn/30 text-sm"
  >
    <svg
      class="w-4 h-4 text-status-warn shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fill-rule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clip-rule="evenodd"
      />
    </svg>
    <p class="flex-1 text-ink-muted">
      Enemies shared with
      <strong class="text-ink">{{ sharedWith.join(', ') }}</strong>.
      Editing here changes all of them.
    </p>
    <BaseButton
      variant="secondary"
      size="sm"
      @click="detach"
    >
      Make independent
    </BaseButton>
  </div>
</template>
