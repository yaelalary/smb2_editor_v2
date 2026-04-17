<script setup lang="ts">
/**
 * Right panel: edits the 8 level header fields for the active slot.
 *
 * Every change goes through `SetLevelFieldCommand` → `useHistoryStore().execute()`,
 * making all mutations undoable via Ctrl+Z.
 *
 * Reactivity: the history store's `revision` counter is used as a
 * dependency so this panel re-renders after every execute/undo/redo
 * without requiring deep reactivity on the LevelMap shallowRef.
 */
import { computed } from 'vue';
import BasePanel from './common/BasePanel.vue';
import PaletteEditor from './PaletteEditor.vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import {
  SetLevelFieldCommand,
  type EditableHeaderField,
} from '@/commands/property-commands';
import type { LevelBlock, LevelHeader } from '@/rom/model';

const rom = useRomStore();
const history = useHistoryStore();

const block = computed<LevelBlock | null>(() => {
  void history.revision; // reactive dependency for model mutations
  const b = rom.activeBlock;
  return b ? (b as LevelBlock) : null;
});

const header = computed<LevelHeader | null>(() => block.value?.header ?? null);

function setField(field: EditableHeaderField, raw: string | number): void {
  const h = header.value;
  if (!h) return;
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
  if (Number.isNaN(value)) return;
  if (h[field] === value) return; // no-op — don't push a command
  history.execute(
    new SetLevelFieldCommand(h, field, value, rom.activeSlot),
  );
}

interface FieldDef {
  key: EditableHeaderField;
  label: string;
  min: number;
  max: number;
  display?: (v: number) => string;
}

const FIELDS: FieldDef[] = [
  {
    key: 'direction',
    label: 'Direction',
    min: 0,
    max: 1,
    display: (v) => (v === 1 ? 'Horizontal' : 'Vertical'),
  },
  { key: 'length', label: 'Length (pages)', min: 0, max: 15 },
  { key: 'music', label: 'Music', min: 0, max: 3 },
  { key: 'palette', label: 'Palette', min: 0, max: 7 },
  { key: 'enemyColor', label: 'Enemy color', min: 0, max: 3 },
  { key: 'groundSet', label: 'Ground set', min: 0, max: 31 },
  { key: 'groundType', label: 'Ground type', min: 0, max: 7 },
  { key: 'objectType', label: 'Object type', min: 0, max: 15 },
];
</script>

<template>
  <BasePanel title="Properties">
    <div
      v-if="!header"
      class="p-4 text-sm text-ink-muted"
    >
      Select a level to edit properties.
    </div>

    <div
      v-else
      class="p-3 space-y-3"
    >
      <div
        v-for="field in FIELDS"
        :key="field.key"
        class="flex items-center justify-between gap-2"
      >
        <label
          :for="`prop-${field.key}`"
          class="text-xs text-ink-muted whitespace-nowrap"
        >
          {{ field.label }}
        </label>

        <!-- Direction: toggle button -->
        <button
          v-if="field.key === 'direction'"
          :id="`prop-${field.key}`"
          class="px-2 py-1 text-xs font-mono rounded border border-panel-border bg-panel-subtle hover:bg-panel transition-colors"
          @click="setField('direction', header.direction === 1 ? 0 : 1)"
        >
          {{ header.direction === 1 ? 'H' : 'V' }}
        </button>

        <!-- Other fields: numeric input -->
        <input
          v-else
          :id="`prop-${field.key}`"
          type="number"
          :min="field.min"
          :max="field.max"
          :value="header[field.key]"
          class="w-16 px-2 py-1 text-xs font-mono text-right rounded border border-panel-border bg-panel focus:outline-accent"
          @change="(e) => setField(field.key, (e.target as HTMLInputElement).value)"
        >
      </div>

      <!-- Palette swatches + editor -->
      <div class="pt-3 border-t border-panel-border">
        <PaletteEditor />
      </div>

      <!-- Undo/Redo status line -->
      <div class="pt-3 border-t border-panel-border text-xs text-ink-muted space-y-1">
        <p v-if="history.canUndo">
          Undo: {{ history.lastUndoLabel }}
        </p>
        <p v-if="history.canRedo">
          Redo: {{ history.lastRedoLabel }}
        </p>
        <p v-if="!history.canUndo && !history.canRedo">
          No changes yet.
        </p>
      </div>
    </div>
  </BasePanel>
</template>
