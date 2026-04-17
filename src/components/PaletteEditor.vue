<script setup lang="ts">
/**
 * Palette editor — Unit 17.
 *
 * Shows the current level's 16-color palette (4 sub-palettes × 4 colors).
 * Clicking a swatch opens a 64-color NES color picker popup.
 * Changes go through SetPaletteColorCommand for undo/redo.
 *
 * ROM structure (per world, 8 sets × 16 bytes):
 *   Pointer: lo=ROM[0xC010+world], hi=ROM[0xC01E+world]
 *   Base = (hi<<8|lo) + 0x4010
 *   Set offset = base + paletteIndex * 16
 *   16 bytes: [bg,c1,c2,c3, bg,c5,c6,c7, bg,c9,cA,cB, bg,cD,cE,cF]
 */
import { computed, ref } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { NES_PALETTE } from '@/rom/nesleveldef';
import { SetPaletteColorCommand } from '@/commands/palette-commands';

const rom = useRomStore();
const history = useHistoryStore();

const pickerOpen = ref(false);
const pickerIndex = ref(-1); // which of the 16 palette entries is being edited

// ─── Palette data from ROM ─────────────────────────────────────────

function getPaletteBase(): number | null {
  const romData = rom.romData;
  if (!romData) return null;
  const world = Math.floor(rom.activeSlot / 30);
  if (world < 0 || world >= 7) return null;
  const lo = romData.rom[0xc010 + world];
  const hi = romData.rom[0xc01e + world];
  if (lo === undefined || hi === undefined) return null;
  return ((hi << 8) | lo) + 0x4010;
}

function getPaletteSetOffset(): number | null {
  const base = getPaletteBase();
  if (base === null) return null;
  const block = rom.activeBlock as { header: { palette: number } } | null;
  if (!block) return null;
  return base + (block.header.palette & 7) * 16;
}

/** Read the 16 NES color indices for the current palette set. */
const paletteEntries = computed(() => {
  void history.revision;
  const romData = rom.romData;
  const offset = getPaletteSetOffset();
  if (!romData || offset === null) return null;

  const entries: { nesIndex: number; rgb: readonly [number, number, number]; romOffset: number }[] = [];
  for (let i = 0; i < 16; i++) {
    const nesIdx = (romData.rom[offset + i] ?? 0) & 0x3f;
    entries.push({
      nesIndex: nesIdx,
      rgb: NES_PALETTE[nesIdx] ?? [0, 0, 0],
      romOffset: offset + i,
    });
  }
  return entries;
});

// ─── NES color picker ──────────────────────────────────────────────

function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

function openPicker(index: number): void {
  pickerIndex.value = index;
  pickerOpen.value = true;
}

function closePicker(): void {
  pickerOpen.value = false;
  pickerIndex.value = -1;
}

function selectColor(nesColorIndex: number): void {
  const entries = paletteEntries.value;
  const romData = rom.romData;
  if (!entries || !romData || pickerIndex.value < 0) return;

  const entry = entries[pickerIndex.value];
  if (!entry || entry.nesIndex === nesColorIndex) {
    closePicker();
    return;
  }

  const palIdx = pickerIndex.value;
  const subPal = Math.floor(palIdx / 4);
  const colIdx = palIdx % 4;
  const label = `W${Math.floor(rom.activeSlot / 30)} pal ${subPal}:${colIdx}`;

  history.execute(
    new SetPaletteColorCommand(
      romData.rom as unknown as Uint8Array,
      entry.romOffset,
      nesColorIndex,
      rom.activeSlot,
      label,
    ),
  );
  closePicker();
}

/** Sub-palette labels. */
const SUB_LABELS = ['Background', 'Sprites 1', 'Sprites 2', 'Sprites 3'];
</script>

<template>
  <div
    v-if="paletteEntries"
    class="space-y-3"
  >
    <h3 class="text-xs font-semibold text-ink-muted uppercase tracking-wide px-3">
      Palette
    </h3>

    <!-- 4 sub-palettes × 4 swatches -->
    <div
      v-for="(label, subIdx) in SUB_LABELS"
      :key="subIdx"
      class="px-3"
    >
      <div class="text-[10px] text-ink-muted mb-1">
        {{ label }}
      </div>
      <div class="flex gap-1">
        <button
          v-for="colIdx in 4"
          :key="colIdx - 1"
          :style="{ backgroundColor: rgbCss(paletteEntries[subIdx * 4 + colIdx - 1]!.rgb) }"
          :title="'NES #' + paletteEntries[subIdx * 4 + colIdx - 1]!.nesIndex.toString(16).padStart(2, '0')"
          class="w-8 h-6 rounded border border-panel-border cursor-pointer
                 hover:ring-2 hover:ring-accent transition-shadow"
          @click="openPicker(subIdx * 4 + colIdx - 1)"
        />
      </div>
    </div>

    <!-- NES color picker popup -->
    <Teleport to="body">
      <div
        v-if="pickerOpen"
        class="fixed inset-0 z-50 flex items-center justify-center"
        @click.self="closePicker"
      >
        <div class="bg-panel border border-panel-border rounded-lg shadow-xl p-4 space-y-2">
          <div class="text-sm font-semibold text-ink">
            Pick NES color
          </div>
          <div class="grid grid-cols-16 gap-0.5">
            <button
              v-for="i in 64"
              :key="i - 1"
              :style="{ backgroundColor: rgbCss(NES_PALETTE[i - 1] ?? [0, 0, 0]) }"
              :title="'0x' + (i - 1).toString(16).padStart(2, '0')"
              class="w-6 h-6 rounded-sm border border-black/20 cursor-pointer
                     hover:ring-2 hover:ring-white transition-shadow"
              @click="selectColor(i - 1)"
            />
          </div>
          <button
            class="text-xs text-ink-muted hover:text-ink underline"
            @click="closePicker"
          >
            Cancel
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
