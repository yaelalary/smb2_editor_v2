<script setup lang="ts">
/**
 * Memory budget indicator — Unit 13.
 *
 * Shows a compact progress bar + percentage in the top bar. Color-coded:
 *   green  < 80%
 *   yellow 80-95%
 *   red    > 95%
 *
 * Emits 'overbudget' so the parent can disable the download button.
 */
import { computed } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { computeUsage } from '@/rom/memory-budget';
import type { LevelMap, EnemyMap } from '@/rom/model';

const rom = useRomStore();
const history = useHistoryStore();

const usage = computed(() => {
  // Re-evaluate when the history revision changes (edits)
  void history.revision;

  const levels = rom.levelMap;
  const enemies = rom.enemyMap;
  if (!levels || !enemies) return null;

  return computeUsage(
    levels as unknown as LevelMap,
    enemies as unknown as EnemyMap,
  );
});

const percent = computed(() => {
  if (!usage.value) return 0;
  return Math.round(usage.value.ratio * 100);
});

const isOverBudget = computed(() => percent.value >= 100);

const colorClass = computed(() => {
  const p = percent.value;
  if (p >= 100) return 'bg-status-danger';
  if (p > 95) return 'bg-status-danger';
  if (p > 80) return 'bg-status-warn';
  return 'bg-status-ok';
});

const tooltip = computed(() => {
  const u = usage.value;
  if (!u) return '';
  if (isOverBudget.value) {
    return `Over budget! ${u.used.toLocaleString()} / ${u.total.toLocaleString()} bytes used. Remove some items to save.`;
  }
  return `${u.used.toLocaleString()} / ${u.total.toLocaleString()} bytes (${u.free.toLocaleString()} free)`;
});

defineExpose({ isOverBudget });
</script>

<template>
  <div
    v-if="usage"
    :title="tooltip"
    class="flex items-center gap-2 text-xs text-ink-muted"
  >
    <span class="font-mono">{{ percent }}%</span>
    <div class="w-20 h-2 rounded-full bg-panel-border overflow-hidden">
      <div
        :class="[colorClass, 'h-full rounded-full transition-all duration-300']"
        :style="{ width: Math.min(percent, 100) + '%' }"
      />
    </div>
    <span
      v-if="isOverBudget"
      class="text-status-danger font-semibold"
    >
      Over budget
    </span>
  </div>
</template>
