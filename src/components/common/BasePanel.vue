<script setup lang="ts">
/**
 * Shared container used for LevelList, TileLibrary, EnemyLibrary,
 * PropertiesPanel, PaletteEditor, LevelLinksEditor.
 *
 * Provides the common frame: surface color, border, optional title
 * header, scrollable content area. Individual panels compose their
 * own content inside.
 */

defineProps<{
  title?: string;
  /** When true, the panel's body does not scroll (for small fixed content). */
  noScroll?: boolean;
}>();
</script>

<template>
  <section
    class="flex flex-col bg-panel border border-panel-border rounded-md overflow-hidden h-full"
  >
    <header
      v-if="title || $slots.header"
      class="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-subtle"
    >
      <h2
        v-if="title"
        class="text-sm font-semibold text-ink"
      >
        {{ title }}
      </h2>
      <slot name="header" />
    </header>

    <div
      :class="[
        'flex-1 min-h-0',
        noScroll ? 'overflow-hidden' : 'overflow-auto',
      ]"
    >
      <slot />
    </div>

    <footer
      v-if="$slots.footer"
      class="px-3 py-2 border-t border-panel-border bg-panel-subtle"
    >
      <slot name="footer" />
    </footer>
  </section>
</template>
