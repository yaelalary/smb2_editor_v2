<script setup lang="ts">
/**
 * Top-level shell. Three possible states in v0.1:
 *   1. `?dev=tiles` query — show the dev CHR tile preview.
 *   2. No ROM loaded — show `RomLoader` centered on the page.
 *   3. ROM loaded — show a stub summary. The real editor UI
 *      (level list + canvas + panels) lands in Unit 6.
 *
 * Mobile / tablet viewports always see a "desktop required" message
 * (driven by Tailwind breakpoints, no JS involved).
 */
import { computed, ref, shallowRef } from 'vue';
import BasePanel from './components/common/BasePanel.vue';
import RomLoader from './components/RomLoader.vue';
import DevTilesPreview from './views/dev/DevTilesPreview.vue';
import DevLevelsPreview from './views/dev/DevLevelsPreview.vue';
import { formatCrc32 } from '@/rom/crc32';
import type { ValidationSuccess } from '@/rom/validation';

const devMode = computed(() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('dev');
});

// `shallowRef` is correct here: the Uint8Array inside should not be
// made deeply reactive (proxying a 256 KB buffer is pointless and
// slow).
const loadedRom = shallowRef<ValidationSuccess | null>(null);
const loadedFileName = ref<string | null>(null);

function onLoaded(rom: ValidationSuccess): void {
  loadedRom.value = rom;
}

function unloadRom(): void {
  loadedRom.value = null;
  loadedFileName.value = null;
}
</script>

<template>
  <DevTilesPreview v-if="devMode === 'tiles'" />
  <DevLevelsPreview v-else-if="devMode === 'levels'" />

  <template v-else>
    <!-- Mobile / tablet viewport: desktop-only editor. -->
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
      v-if="!loadedRom"
      class="hidden lg:flex min-h-screen items-center justify-center p-6"
    >
      <RomLoader @loaded="onLoaded" />
    </main>

    <!-- Desktop: ROM loaded → stub editor shell. -->
    <main
      v-else
      class="hidden lg:flex min-h-screen items-center justify-center p-6"
    >
      <BasePanel
        title="ROM loaded"
        class="w-full max-w-xl"
      >
        <div class="p-6 space-y-3 text-sm">
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt class="text-ink-muted">
              Size
            </dt>
            <dd class="font-mono">
              {{ loadedRom.rom.byteLength }} bytes
            </dd>
            <dt class="text-ink-muted">
              PRG-ROM
            </dt>
            <dd class="font-mono">
              {{ loadedRom.prgBytes }} bytes · CRC32
              {{ formatCrc32(loadedRom.prgCrc32) }}
            </dd>
            <dt class="text-ink-muted">
              CHR-ROM
            </dt>
            <dd class="font-mono">
              {{ loadedRom.chrBytes }} bytes
            </dd>
            <dt class="text-ink-muted">
              Trainer
            </dt>
            <dd>
              {{ loadedRom.hasTrainer ? 'present (512 B)' : 'none' }}
            </dd>
          </dl>
          <p class="text-xs text-ink-muted pt-2">
            The level list and canvas arrive in Unit 6. For now this is
            just proof that validation + load works end-to-end.
          </p>
          <button
            class="text-xs text-ink-muted hover:text-ink underline"
            @click="unloadRom"
          >
            Load a different ROM
          </button>
        </div>
      </BasePanel>
    </main>
  </template>
</template>
