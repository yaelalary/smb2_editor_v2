<script setup lang="ts">
/**
 * Data sharing editor (advanced).
 *
 * SMB2 has 210 "room" slots (7 worlds × 3 levels × 10 sub-levels).
 * Each slot points at a layout data block and an enemy data block in
 * ROM. Multiple rooms can share the same block to save ROM space
 * (e.g. sub-space rooms reuse the same layout).
 *
 * This panel lets power users reassign those block pointers. It does
 * NOT control where doors lead — that's handled per-item in the
 * Item Inspector (see `ItemInspector.vue`).
 */
import { computed } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { SetSlotMappingCommand } from '@/commands/link-commands';
import { slotLabel, slotLabelVerbose } from '@/rom/level-layout';
import type { LevelMap, EnemyMap } from '@/rom/model';

const rom = useRomStore();
const history = useHistoryStore();

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
    const name = slotLabel(s);
    return c > 1 ? `${name} data (shared by ${c} rooms)` : `${name} data`;
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

  const groups: { worldLabel: string; rooms: { slot: number; label: string; title: string; levelBlock: number; enemyBlock: number }[] }[] = [];

  for (let wg = 0; wg < 7; wg++) {
    const rooms: typeof groups[number]['rooms'] = [];
    for (let i = 0; i < 30; i++) {
      const slot = wg * 30 + i;
      rooms.push({
        slot,
        label: slotLabel(slot),
        title: slotLabelVerbose(slot),
        levelBlock: lm.slotToBlock[slot] ?? 0,
        enemyBlock: em.slotToBlock[slot] ?? 0,
      });
    }
    groups.push({ worldLabel: `World ${wg + 1}`, rooms });
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
  <BasePanel title="Data sharing (advanced)">
    <p class="px-3 py-2 text-[10px] text-ink-muted leading-snug border-b border-panel-border">
      Each of the 210 rooms points at a layout block and an enemy block in the ROM.
      Multiple rooms can share the same block to save space. Most rooms use their
      default block — only change this if you know what you're doing.
    </p>
    <p class="px-3 pb-2 text-[10px] text-ink-muted leading-snug border-b border-panel-border">
      To change where a <em>door</em> or <em>jar</em> leads, click it on the canvas
      and use the Item Inspector on the right.
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
                Room
              </th>
              <th class="px-2 py-1 text-left font-medium">
                Layout data
              </th>
              <th class="px-2 py-1 text-left font-medium">
                Enemy data
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in group.rooms"
              :key="a.slot"
              :class="[
                'border-b border-panel-border/30 hover:bg-panel-subtle transition-colors',
                a.slot === rom.activeSlot ? 'bg-accent/10' : '',
              ]"
            >
              <td
                class="px-2 py-1 font-mono text-ink-muted whitespace-nowrap cursor-pointer hover:text-ink"
                :title="a.title"
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
