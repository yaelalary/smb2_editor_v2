<script setup lang="ts">
/**
 * Area connections editor — Unit 18.
 *
 * In SMB2, each "level" (like World 1-1) is made of several AREAS
 * connected by doors and jars. The game has 210 area slots. Each
 * slot loads a piece of level data and a piece of enemy data.
 * Multiple areas can share the same data (e.g. the subspace areas
 * reuse the same layout).
 *
 * This editor lets the user see and change which data each area loads.
 * It shows all 210 areas grouped by world, with dropdowns to reassign
 * what level/enemy data each area uses.
 */
import { computed } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { SetSlotMappingCommand } from '@/commands/link-commands';
import { LEVELS_PER_WORLD } from '@/rom/constants';
import type { LevelMap, EnemyMap } from '@/rom/model';

const rom = useRomStore();
const history = useHistoryStore();

function areaLabel(slot: number): string {
  const w = Math.floor(slot / LEVELS_PER_WORLD);
  const l = slot % LEVELS_PER_WORLD;
  return `W${w} area ${l}`;
}

function shortLabel(slot: number): string {
  return `W${Math.floor(slot / LEVELS_PER_WORLD)}:${slot % LEVELS_PER_WORLD}`;
}

/**
 * For each block, find the first area that uses it → used as the
 * display name in dropdowns. Shows sharing info when relevant.
 */
function buildBlockLabels(
  slotToBlock: ReadonlyArray<number>,
  blockCount: number,
): string[] {
  const firstSlot: (number | null)[] = new Array(blockCount).fill(null);
  const counts: number[] = new Array(blockCount).fill(0);

  for (let s = 0; s < slotToBlock.length; s++) {
    const b = slotToBlock[s]!;
    counts[b] = (counts[b] ?? 0) + 1;
    if (firstSlot[b] === null) firstSlot[b] = s;
  }

  return firstSlot.map((s, i) => {
    if (s === null) return '(unused data)';
    const c = counts[i] ?? 0;
    const name = shortLabel(s);
    return c > 1 ? `${name} data (shared by ${c} areas)` : `${name} data`;
  });
}

const levelBlockLabels = computed(() => {
  void history.revision;
  const lm = rom.levelMap;
  if (!lm) return [];
  return buildBlockLabels(lm.slotToBlock, lm.blocks.length);
});

const enemyBlockLabels = computed(() => {
  void history.revision;
  const em = rom.enemyMap;
  if (!em) return [];
  return buildBlockLabels(em.slotToBlock, em.blocks.length);
});

/** Group the 210 areas by world (30 per world group). */
const worldGroups = computed(() => {
  void history.revision;
  const lm = rom.levelMap;
  const em = rom.enemyMap;
  if (!lm || !em) return [];

  const groups: { worldLabel: string; areas: { slot: number; label: string; levelBlock: number; enemyBlock: number }[] }[] = [];

  for (let wg = 0; wg < 7; wg++) {
    const areas: typeof groups[number]['areas'] = [];
    for (let i = 0; i < 30; i++) {
      const slot = wg * 30 + i;
      areas.push({
        slot,
        label: areaLabel(slot),
        levelBlock: lm.slotToBlock[slot] ?? 0,
        enemyBlock: em.slotToBlock[slot] ?? 0,
      });
    }
    groups.push({ worldLabel: `World ${wg + 1}`, areas });
  }
  return groups;
});

function setLevelBlock(slot: number, newBlock: number): void {
  const lm = rom.levelMap;
  const em = rom.enemyMap;
  if (!lm || !em) return;
  history.execute(
    new SetSlotMappingCommand(
      lm as unknown as LevelMap,
      em as unknown as EnemyMap,
      slot,
      newBlock,
      em.slotToBlock[slot] ?? 0,
    ),
  );
}

function setEnemyBlock(slot: number, newBlock: number): void {
  const lm = rom.levelMap;
  const em = rom.enemyMap;
  if (!lm || !em) return;
  history.execute(
    new SetSlotMappingCommand(
      lm as unknown as LevelMap,
      em as unknown as EnemyMap,
      slot,
      lm.slotToBlock[slot] ?? 0,
      newBlock,
    ),
  );
}
</script>

<template>
  <BasePanel title="Area connections">
    <p class="px-3 py-2 text-[10px] text-ink-muted leading-snug border-b border-panel-border">
      Each level is made of areas connected by doors and jars.
      Change which layout and enemies an area loads.
    </p>

    <div class="overflow-auto">
      <details
        v-for="group in worldGroups"
        :key="group.worldLabel"
        class="border-b border-panel-border"
      >
        <summary
          class="px-3 py-2 text-xs font-semibold text-ink-muted uppercase tracking-wide
                 cursor-pointer select-none hover:bg-panel-subtle sticky top-0 bg-panel z-10"
        >
          {{ group.worldLabel }}
        </summary>

        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-panel-border/50 text-ink-muted">
              <th class="px-2 py-1 text-left font-medium">
                Area
              </th>
              <th class="px-2 py-1 text-left font-medium">
                Layout
              </th>
              <th class="px-2 py-1 text-left font-medium">
                Enemies
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in group.areas"
              :key="a.slot"
              :class="[
                'border-b border-panel-border/30 hover:bg-panel-subtle transition-colors',
                a.slot === rom.activeSlot ? 'bg-accent/10' : '',
              ]"
            >
              <td
                class="px-2 py-1 font-mono text-ink-muted whitespace-nowrap cursor-pointer hover:text-ink"
                @click="rom.selectSlot(a.slot)"
              >
                {{ a.label }}
              </td>
              <td class="px-2 py-1">
                <select
                  :value="a.levelBlock"
                  class="w-full bg-panel border border-panel-border rounded px-1 py-0.5 text-[10px]"
                  @change="setLevelBlock(a.slot, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option
                    v-for="(lbl, idx) in levelBlockLabels"
                    :key="idx"
                    :value="idx"
                  >
                    {{ lbl }}
                  </option>
                </select>
              </td>
              <td class="px-2 py-1">
                <select
                  :value="a.enemyBlock"
                  class="w-full bg-panel border border-panel-border rounded px-1 py-0.5 text-[10px]"
                  @change="setEnemyBlock(a.slot, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option
                    v-for="(lbl, idx) in enemyBlockLabels"
                    :key="idx"
                    :value="idx"
                  >
                    {{ lbl }}
                  </option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
  </BasePanel>
</template>
