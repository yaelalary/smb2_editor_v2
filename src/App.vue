<script setup lang="ts">
/**
 * Top-level shell. Four states:
 *
 *   1. `?dev=tiles` / `?dev=levels` — dev tools (not part of main flow).
 *   2. Mobile / tablet viewport — "Desktop only" message (CSS-driven).
 *   3. No ROM loaded — centered `RomLoader` drop zone.
 *   4. ROM loaded — three-panel editor layout: level list (left) +
 *      canvas (center) + info bar (top). The canvas shows the selected
 *      level's items as positioned colored rectangles (v0.1). Sprite-
 *      tile rendering replaces these rectangles when the lookup tables
 *      are ported in Phase 2.
 */
import { computed, ref } from 'vue';
import RomLoader from './components/RomLoader.vue';
import LevelList from './components/LevelList.vue';
import LevelCanvas from './components/LevelCanvas.vue';
import PropertiesPanel from './components/PropertiesPanel.vue';
import TileLibrary from './components/TileLibrary.vue';
import EnemyLibrary from './components/EnemyLibrary.vue';
import LevelLinksEditor from './components/LevelLinksEditor.vue';
import SharedEnemyBanner from './components/SharedEnemyBanner.vue';
import MemoryBudgetIndicator from './components/MemoryBudgetIndicator.vue';
import ConfirmationDialog from './components/ConfirmationDialog.vue';
import ToastContainer from './components/ToastContainer.vue';
import BaseButton from './components/common/BaseButton.vue';
import { useEditorStore } from '@/stores/editor';
import DevTilesPreview from './views/dev/DevTilesPreview.vue';
import DevLevelsPreview from './views/dev/DevLevelsPreview.vue';
import { useRomStore } from '@/stores/rom';
import { downloadRom } from '@/persistence/rom-download';
import { buildRom } from '@/rom/rom-builder';
import { downloadProject, importProject } from '@/persistence/project-file';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { useHistoryStore } from '@/stores/history';
import { useToast } from '@/composables/useToast';
import type { ValidationSuccess } from '@/rom/validation';

const rom = useRomStore();
const editor = useEditorStore();
const history = useHistoryStore();
const { show: showToast } = useToast();
useKeyboardShortcuts();

const budgetRef = ref<InstanceType<typeof MemoryBudgetIndicator> | null>(null);
const showUnloadConfirm = ref(false);

function onUnloadClick(): void {
  // If there are unsaved edits, confirm first.
  if (history.canUndo) {
    showUnloadConfirm.value = true;
  } else {
    rom.unload();
    history.clear();
  }
}

function confirmUnload(): void {
  showUnloadConfirm.value = false;
  rom.unload();
  history.clear();
}

function cancelUnload(): void {
  showUnloadConfirm.value = false;
}

const devMode = computed(() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('dev');
});

function onLoaded(validation: ValidationSuccess): void {
  rom.loadRom(validation);
}

const projectInputRef = ref<HTMLInputElement | null>(null);

function onExportProject(): void {
  const data = rom.romData;
  const levels = rom.levelMap;
  const enemies = rom.enemyMap;
  if (!data || !levels || !enemies) return;
  downloadProject(
    data.rom,
    levels as unknown as import('@/rom/model').LevelMap,
    enemies as unknown as import('@/rom/model').EnemyMap,
    rom.activeSlot,
  );
  showToast('Project exported');
}

function onImportClick(): void {
  projectInputRef.value?.click();
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const result = await importProject(file);
  if ('kind' in result) {
    showToast(result.message);
    return;
  }

  rom.loadRom(result.validation);
  rom.selectSlot(result.activeSlot);
  history.clear();
  showToast('Project imported');
}

function onDownload(): void {
  const data = rom.romData;
  const levels = rom.levelMap;
  const enemies = rom.enemyMap;
  if (!data || !levels || !enemies) return;

  // Build the output ROM through the full serialize pipeline:
  // clone original → overlay serialized level blocks → overlay enemy blocks.
  // For v0.1 (conservative mode) this produces byte-identical output.
  // Phase 2+ with constructive serialization produces the edited ROM.
  // Cast to strip Pinia's DeepReadonly — buildRom only reads, never mutates.
  const outputRom = buildRom(
    data.rom,
    levels as unknown as import('@/rom/model').LevelMap,
    enemies as unknown as import('@/rom/model').EnemyMap,
  );
  downloadRom(outputRom, 'smb2.nes');
}
</script>

<template>
  <!-- Dev tools -->
  <DevTilesPreview v-if="devMode === 'tiles'" />
  <DevLevelsPreview v-else-if="devMode === 'levels'" />

  <template v-else>
    <!-- Mobile gate (CSS-only via Tailwind breakpoint). -->
    <main
      class="lg:hidden min-h-screen flex items-center justify-center p-6"
    >
      <div class="max-w-sm text-center space-y-3">
        <h1 class="text-xl font-bold">
          Desktop only
        </h1>
        <p class="text-sm text-ink-muted">
          SMB2 Editor needs a desktop or laptop browser. Drag-and-drop
          tile editing isn't practical on touch screens.
        </p>
      </div>
    </main>

    <!-- Desktop: no ROM loaded → RomLoader. -->
    <main
      v-if="!rom.isLoaded"
      class="hidden lg:flex min-h-screen items-center justify-center p-6"
    >
      <RomLoader @loaded="onLoaded" />
    </main>

    <!-- Desktop: ROM loaded → three-panel editor layout. -->
    <div
      v-else
      class="hidden lg:grid h-screen"
      style="grid-template-columns: var(--spacing-panel-library) 1fr var(--spacing-panel-properties); grid-template-rows: var(--spacing-toolbar-height) 1fr;"
    >
      <!-- Top bar -->
      <header
        class="col-span-3 flex items-center justify-between px-4 bg-panel border-b border-panel-border"
      >
        <div class="flex items-center gap-3 text-sm">
          <span class="font-semibold">SMB2 Editor</span>
          <span class="text-ink-muted">·</span>
          <span class="text-ink-muted font-mono text-xs">
            {{ rom.activeSlotLabel }} — block #{{ rom.levelMap?.slotToBlock[rom.activeSlot] }}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <MemoryBudgetIndicator ref="budgetRef" />
          <BaseButton
            variant="primary"
            size="sm"
            :disabled="budgetRef?.isOverBudget"
            :title="budgetRef?.isOverBudget ? 'Too much data — remove some items to save' : ''"
            @click="onDownload"
          >
            Download ROM
          </BaseButton>
          <BaseButton
            variant="secondary"
            size="sm"
            @click="onExportProject"
          >
            Export project
          </BaseButton>
          <BaseButton
            variant="secondary"
            size="sm"
            @click="onImportClick"
          >
            Import project
          </BaseButton>
          <input
            ref="projectInputRef"
            type="file"
            accept=".smb2proj"
            class="hidden"
            @change="onImportFile"
          >
          <button
            class="text-xs text-ink-muted hover:text-ink underline"
            @click="onUnloadClick"
          >
            Load a different ROM
          </button>
        </div>
      </header>

      <!-- Left: level list (top 1/3) + tile library (bottom 2/3) -->
      <div
        class="min-h-0 border-r border-panel-border grid"
        style="grid-template-rows: minmax(0, 1fr) auto minmax(0, 2fr);"
      >
        <LevelList class="min-h-0 overflow-hidden border-b border-panel-border" />

        <!-- Tool tabs: Tiles / Enemies / Areas -->
        <div class="flex border-b border-panel-border bg-panel-subtle">
          <button
            :class="[
              'flex-1 px-3 py-1.5 text-xs font-semibold transition-colors text-center',
              editor.activeTool === 'tiles'
                ? 'bg-panel text-ink border-b-2 border-accent'
                : 'text-ink-muted hover:text-ink',
            ]"
            @click="editor.activeTool = 'tiles'"
          >
            Tiles
          </button>
          <button
            :class="[
              'flex-1 px-3 py-1.5 text-xs font-semibold transition-colors text-center',
              editor.activeTool === 'enemies'
                ? 'bg-panel text-ink border-b-2 border-accent'
                : 'text-ink-muted hover:text-ink',
            ]"
            @click="editor.activeTool = 'enemies'"
          >
            Enemies
          </button>
          <button
            :class="[
              'flex-1 px-3 py-1.5 text-xs font-semibold transition-colors text-center',
              editor.activeTool === 'links'
                ? 'bg-panel text-ink border-b-2 border-accent'
                : 'text-ink-muted hover:text-ink',
            ]"
            @click="editor.activeTool = 'links'"
          >
            Areas
          </button>
        </div>

        <TileLibrary
          v-if="editor.activeTool === 'tiles'"
          class="min-h-0 overflow-hidden"
        />
        <EnemyLibrary
          v-else-if="editor.activeTool === 'enemies'"
          class="min-h-0 overflow-hidden"
        />
        <LevelLinksEditor
          v-else
          class="min-h-0 overflow-hidden"
        />
      </div>

      <!-- Center: shared enemy banner + level canvas -->
      <div class="min-h-0 flex flex-col">
        <SharedEnemyBanner />
        <LevelCanvas class="flex-1 min-h-0" />
      </div>

      <!-- Right: properties panel -->
      <PropertiesPanel class="min-h-0 border-l border-panel-border" />
    </div>
  </template>

  <ConfirmationDialog
    :open="showUnloadConfirm"
    title="Load a different ROM?"
    message="You have unsaved edits. Loading a new ROM will discard all your changes. Consider exporting your project first."
    confirm-label="Discard and load new ROM"
    @confirm="confirmUnload"
    @cancel="cancelUnload"
  />

  <ToastContainer />
</template>
