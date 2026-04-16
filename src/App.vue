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
import { computed } from 'vue';
import RomLoader from './components/RomLoader.vue';
import LevelList from './components/LevelList.vue';
import LevelCanvas from './components/LevelCanvas.vue';
import PropertiesPanel from './components/PropertiesPanel.vue';
import TileLibrary from './components/TileLibrary.vue';
import BaseButton from './components/common/BaseButton.vue';
import DevTilesPreview from './views/dev/DevTilesPreview.vue';
import DevLevelsPreview from './views/dev/DevLevelsPreview.vue';
import { useRomStore } from '@/stores/rom';
import { downloadRom } from '@/persistence/rom-download';
import { buildRom } from '@/rom/rom-builder';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import type { ValidationSuccess } from '@/rom/validation';

const rom = useRomStore();
useKeyboardShortcuts();

const devMode = computed(() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('dev');
});

function onLoaded(validation: ValidationSuccess): void {
  rom.loadRom(validation);
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
          <BaseButton
            variant="primary"
            size="sm"
            @click="onDownload"
          >
            Download ROM
          </BaseButton>
          <button
            class="text-xs text-ink-muted hover:text-ink underline"
            @click="rom.unload()"
          >
            Load a different ROM
          </button>
        </div>
      </header>

      <!-- Left: level list (top 1/3) + tile library (bottom 2/3) -->
      <div
        class="min-h-0 border-r border-panel-border grid"
        style="grid-template-rows: minmax(0, 1fr) minmax(0, 2fr);"
      >
        <LevelList class="min-h-0 overflow-hidden border-b border-panel-border" />
        <TileLibrary class="min-h-0 overflow-hidden" />
      </div>

      <!-- Center: level canvas -->
      <LevelCanvas class="min-h-0" />

      <!-- Right: properties panel -->
      <PropertiesPanel class="min-h-0 border-l border-panel-border" />
    </div>
  </template>
</template>
