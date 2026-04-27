<script setup lang="ts">
/**
 * Enemy Inspector — right-panel view shown when exactly one enemy is
 * selected on the canvas. Mirrors the shape of `ItemInspector` but for
 * enemy entities: name, position, hidden flag, and a delete action.
 *
 * Selection lives in the editor store (`editor.selectedEnemies`) so the
 * EnemyLibrary can highlight the corresponding card and the canvas can
 * draw the selection ring — all three views read from the same source.
 */

import { computed } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { ENEMY_NAMES } from '@/rom/nesleveldef';
import { DeleteEnemyCommand } from '@/commands/enemy-commands';
import type { EnemyBlock } from '@/rom/model';

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();

const selection = computed(() => {
  void history.revision;
  const sel = editor.selectedEnemies;
  return sel.length === 1 ? sel[0]! : null;
});

const enemyTypeId = computed(() => {
  const s = selection.value;
  return s ? s.enemy.id & 0x7f : null;
});

const enemyName = computed(() => {
  const id = enemyTypeId.value;
  if (id === null) return '';
  return ENEMY_NAMES[id] ?? `Enemy #${id}`;
});

const isHidden = computed(() => {
  const s = selection.value;
  return s ? (s.enemy.id & 0x80) !== 0 : false;
});

const absolutePosition = computed(() => {
  const s = selection.value;
  if (!s) return null;
  const b = rom.activeBlock;
  if (!b) return null;
  const isH = (b as { header: { direction: number } }).header.direction === 1;
  const absX = isH ? s.pageIndex * 16 + s.enemy.x : s.enemy.x;
  const absY = isH ? s.enemy.y : s.pageIndex * 16 + s.enemy.y;
  return { x: absX, y: absY, page: s.pageIndex };
});

function deleteSelected(): void {
  const s = selection.value;
  if (!s) return;
  const eb = rom.activeEnemyBlock;
  if (!eb) return;
  history.execute(new DeleteEnemyCommand(eb as EnemyBlock, s.pageIndex, s.enemy, rom.activeSlot));
  editor.selectedEnemies = [];
}
</script>

<template>
  <div
    v-if="selection"
    class="p-3 space-y-3"
  >
    <div class="space-y-0.5">
      <div class="text-[10px] uppercase tracking-wide text-ink-muted">
        Enemy
        <span
          v-if="isHidden"
          class="ml-1 px-1 py-0.5 rounded text-[9px] bg-accent/20 text-accent normal-case tracking-normal"
        >
          hidden
        </span>
      </div>
      <div class="text-sm font-semibold text-ink">
        {{ enemyName }}
      </div>
      <div
        v-if="absolutePosition"
        class="text-[10px] text-ink-muted"
      >
        Position ({{ absolutePosition.x }}, {{ absolutePosition.y }})
        · page {{ absolutePosition.page }}
      </div>
    </div>

    <button
      class="w-full px-2 py-1 text-xs rounded border border-status-danger/40 bg-status-danger/10 hover:bg-status-danger/20 text-status-danger transition-colors flex items-center justify-center gap-1.5"
      @click="deleteSelected"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        class="w-3.5 h-3.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
        />
      </svg>
      Delete
    </button>
  </div>
</template>
