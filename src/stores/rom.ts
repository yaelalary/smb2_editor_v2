/**
 * Central ROM state — Unit 6.
 *
 * Holds the validated ROM bytes plus the fully-parsed level and enemy
 * maps. Exposed as `DeepReadonly` outside the store so no component
 * can mutate the model directly — all future mutations go through
 * `useHistoryStore().execute(cmd)` (Unit 8+).
 *
 * The store is setup-style (Composition API), per AGENTS.md.
 */

import { computed, type DeepReadonly, readonly, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { ValidationSuccess } from '@/rom/validation';
import type { EnemyMap, LevelBlock, LevelMap } from '@/rom/model';
import { parseLevelMap } from '@/rom/level-parser';
import { parseEnemyMap } from '@/rom/enemy-parser';
import { LEVELS_PER_WORLD } from '@/rom/constants';

export const useRomStore = defineStore('rom', () => {
  const romData = shallowRef<ValidationSuccess | null>(null);
  const levelMap = shallowRef<LevelMap | null>(null);
  const enemyMap = shallowRef<EnemyMap | null>(null);
  const activeSlot = shallowRef<number>(0);

  /** True once a valid ROM has been loaded and parsed. */
  const isLoaded = computed(() => romData.value !== null);

  /** The level block for the currently-selected slot, or null. */
  const activeBlock = computed<DeepReadonly<LevelBlock> | null>(() => {
    const map = levelMap.value;
    if (!map) return null;
    const idx = map.slotToBlock[activeSlot.value];
    if (idx === undefined) return null;
    return map.blocks[idx] ?? null;
  });

  /** "W{w}:L{l}" label for the active slot (debug/display). */
  const activeSlotLabel = computed(() => {
    const s = activeSlot.value;
    const w = Math.floor(s / LEVELS_PER_WORLD);
    const l = s % LEVELS_PER_WORLD;
    return `W${w}:L${l}`;
  });

  function loadRom(validation: ValidationSuccess): void {
    romData.value = validation;
    levelMap.value = parseLevelMap(validation.rom);
    enemyMap.value = parseEnemyMap(validation.rom);
    activeSlot.value = 0;
  }

  function selectSlot(slot: number): void {
    if (slot >= 0 && slot < 210) {
      activeSlot.value = slot;
    }
  }

  function unload(): void {
    romData.value = null;
    levelMap.value = null;
    enemyMap.value = null;
    activeSlot.value = 0;
  }

  return {
    romData: readonly(romData),
    levelMap: readonly(levelMap),
    enemyMap: readonly(enemyMap),
    activeSlot: readonly(activeSlot),
    isLoaded,
    activeBlock,
    activeSlotLabel,
    loadRom,
    selectSlot,
    unload,
  };
});
