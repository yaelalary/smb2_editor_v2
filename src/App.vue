<script setup lang="ts">
import BasePanel from './components/common/BasePanel.vue';
import BaseButton from './components/common/BaseButton.vue';

// Unit 1 scaffold: placeholder landing view. The real three-panel layout
// (library / canvas / properties) lands in Unit 6 once the ROM loader
// and level viewer are in place.
</script>

<template>
  <main
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
      </div>
    </BasePanel>
  </main>
</template>
