<script setup lang="ts">
import { computed } from 'vue';
import BasePanel from './components/common/BasePanel.vue';
import BaseButton from './components/common/BaseButton.vue';
import DevTilesPreview from './views/dev/DevTilesPreview.vue';

// Unit 1 scaffold + Unit 2 dev tool: placeholder landing, with a
// `?dev=tiles` escape hatch that renders the extracted CHR tile atlas
// for visual sanity check. The real three-panel editor layout (library
// / canvas / properties) lands in Unit 6.
const devMode = computed(() => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('dev');
});
</script>

<template>
  <DevTilesPreview v-if="devMode === 'tiles'" />

  <main
    v-else
    class="min-h-screen flex items-center justify-center p-6"
  >
    <BasePanel
      title="SMB2 Editor"
      class="w-full max-w-xl"
    >
      <div class="p-6 space-y-4">
        <p class="text-[var(--color-ink-muted)]">
          Web-based level editor for Super Mario Bros. 2 (NES, USA PRG0).
          Drop your ROM to get started — it stays entirely in your browser.
        </p>
        <p class="text-sm text-[var(--color-ink-muted)]">
          Scaffolding — the real loader arrives in Unit 3.
        </p>
        <BaseButton
          variant="primary"
          disabled
        >
          Load ROM (coming in Unit 3)
        </BaseButton>
        <p class="text-xs text-[var(--color-ink-muted)] pt-4 border-t border-[var(--color-panel-border)]">
          Dev: <a
            href="?dev=tiles"
            class="underline hover:text-[var(--color-accent)]"
          >view extracted CHR tiles</a>
        </p>
      </div>
    </BasePanel>
  </main>
</template>
