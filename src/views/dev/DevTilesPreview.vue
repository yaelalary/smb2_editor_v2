<script setup lang="ts">
/**
 * Dev tool — visual sanity check for the CHR tile atlas.
 *
 * Not part of the shipping app. Accessed via `?dev=tiles` query string.
 * Useful while iterating on the extraction pipeline; safe to delete
 * once Unit 6's level canvas lands.
 *
 * Tiles are rendered at 4× (32×32 display, 8×8 source) with pixelated
 * scaling so individual pixels stay crisp. Color index 0..3 appears
 * as grayscale 0 / 85 / 170 / 255 in the R channel.
 */
import { ref, computed } from 'vue';
import { TILE_URLS } from '@/assets/tiles';

const search = ref('');

const filteredTiles = computed(() => {
  if (!search.value.trim()) {
    return TILE_URLS.map((url, index) => ({ url, index }));
  }
  const target = Number.parseInt(search.value, 10);
  if (Number.isNaN(target)) return [];
  const url = TILE_URLS[target];
  return url === undefined ? [] : [{ url, index: target }];
});
</script>

<template>
  <main class="p-6 max-w-300 mx-auto">
    <header class="mb-6">
      <h1 class="text-2xl font-bold mb-2">
        CHR Tile Preview
      </h1>
      <p class="text-sm text-ink-muted mb-4">
        {{ TILE_URLS.length }} tiles extracted from
        <code class="px-1 bg-panel-subtle rounded">test/fixtures/smb2.nes</code>.
        Grayscale encodes the 2-bit color index (0/85/170/255 in the red
        channel). Runtime rendering re-colors these via the level's active
        NES palette.
      </p>
      <div class="flex gap-2 items-center">
        <label
          class="text-sm font-medium"
          for="tile-search"
        >Jump to tile ID:</label>
        <input
          id="tile-search"
          v-model="search"
          type="number"
          :min="0"
          :max="TILE_URLS.length - 1"
          placeholder="e.g. 42"
          class="px-2 py-1 text-sm border border-panel-border rounded bg-panel"
        >
        <button
          v-if="search"
          class="text-sm text-ink-muted hover:text-ink"
          @click="search = ''"
        >
          Clear
        </button>
      </div>
    </header>

    <div
      v-if="filteredTiles.length === 0"
      class="text-sm text-status-danger"
    >
      No tiles to display. Did you run <code>npm run extract-chr</code>?
    </div>

    <div
      v-else
      class="grid gap-0.5 bg-panel-border p-0.5 rounded"
      style="grid-template-columns: repeat(32, 32px);"
    >
      <div
        v-for="tile in filteredTiles"
        :key="tile.index"
        class="relative bg-black group"
      >
        <img
          :src="tile.url"
          :alt="`Tile ${tile.index}`"
          :title="`Tile ${tile.index}`"
          class="w-8 h-8 block [image-rendering:pixelated]"
          loading="lazy"
        >
        <span
          class="absolute inset-0 flex items-center justify-center bg-black/70 text-[10px] font-mono text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        >
          {{ tile.index }}
        </span>
      </div>
    </div>
  </main>
</template>
