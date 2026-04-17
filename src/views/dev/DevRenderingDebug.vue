<script setup lang="ts">
/**
 * Dev tool — rendering diagnostic. Accessed via ?dev=rendering.
 *
 * Compares ROM-read tile IDs vs static table tile IDs for ground
 * and extended items. Shows the actual atlas tiles visually so we
 * can determine which approach gives correct results.
 */
import { ref, computed, onMounted } from 'vue';
import RomLoader from '@/components/RomLoader.vue';
import type { ValidationSuccess } from '@/rom/validation';
import { parseLevelMap } from '@/rom/level-parser';
import { getFxForSlot } from '@/rom/level-layout';
import { getBgSet, getBgTile, getObjTile } from '@/rom/tile-reader';
import { GROUND_SET_H, GROUND_SET_V, GROUND_TYPE_H } from '@/rom/nesleveldef';
import { readLevelPalette } from '@/rom/palette-reader';
import {
  preloadAllAtlases,
  getAtlasImage,
  getColorizedAtlas,
  metatileRect,
  METATILE_SIZE,
} from '@/assets/metatiles';

const romData = ref<ValidationSuccess | null>(null);
const slot = ref(0);

function onLoaded(v: ValidationSuccess): void {
  romData.value = v;
}

onMounted(async () => {
  await preloadAllAtlases();
});

const rom = computed(() => romData.value?.rom ?? null);
const levelMap = computed(() => rom.value ? parseLevelMap(rom.value) : null);

const header = computed(() => {
  const lm = levelMap.value;
  if (!lm) return null;
  const blockIdx = lm.slotToBlock[slot.value];
  if (blockIdx === undefined) return null;
  return lm.blocks[blockIdx]?.header ?? null;
});

const world = computed(() => Math.floor(slot.value / 30));
const fx = computed(() => getFxForSlot(slot.value));
const atlas = computed(() => fx.value + 4);

const palette = computed(() => {
  if (!rom.value || !header.value) return null;
  return readLevelPalette(rom.value, slot.value, header.value.palette);
});

// ─── Ground comparison ─────────────────────────────────────────────

const groundComparison = computed(() => {
  const r = rom.value;
  const h = header.value;
  if (!r || !h) return null;

  const gSet = h.groundSet;
  const gType = h.groundType;
  const w = world.value;
  const f = fx.value;

  // ROM-read bitmask
  const isH = h.direction === 1;
  const romBitmask = getBgSet(r, gSet & 0x1f, isH);
  // Static table bitmask (use correct table based on direction!)
  const gsTable = isH ? GROUND_SET_H : GROUND_SET_V;
  const staticBitmask = gsTable[gSet & 0x1f] ?? 0;

  // Ground type tiles for each bitset value (1-3)
  const tileComparisons: {
    bitset: number;
    romTileId: number;
    staticBE: number;
    staticLE: number;
  }[] = [];

  const staticEntry = GROUND_TYPE_H[f]?.[gType & 0x07];

  for (let bs = 1; bs <= 3; bs++) {
    const romTile = getBgTile(r, bs, gType & 0x07, w, h.direction === 1);

    // Current gd() is big-endian → staticEntry[bs] is BE
    const staticBE = staticEntry?.[bs] ?? 0xff;

    // What LE would give: reverse the byte extraction
    const rawDword = getRawDword(f, gType & 0x07);
    const leBytes = [
      rawDword & 0xff,
      (rawDword >>> 8) & 0xff,
      (rawDword >>> 16) & 0xff,
      (rawDword >>> 24) & 0xff,
    ];
    const staticLE = leBytes[bs] ?? 0xff;

    tileComparisons.push({ bitset: bs, romTileId: romTile, staticBE, staticLE });
  }

  // Which bitset values appear in the bitmask (rows 0-14)
  const activeRows: { row: number; bitset: number }[] = [];
  for (let row = 0; row < 15; row++) {
    const bit = 30 - row * 2;
    const bs = (romBitmask >>> bit) & 0x03;
    if (bs !== 0) activeRows.push({ row, bitset: bs });
  }

  return {
    gSet, gType, world: w, fx: f, atlas: atlas.value,
    romBitmask: '0x' + romBitmask.toString(16).padStart(8, '0'),
    staticBitmask: '0x' + staticBitmask.toString(16).padStart(8, '0'),
    bitmaskMatch: romBitmask === staticBitmask,
    tileComparisons,
    activeRows,
  };
});

// ─── Helpers ───────────────────────────────────────────────────────

/** Get the raw DWORD value from GROUND_TYPE_H source data. */
function getRawDword(f: number, gType: number): number {
  // Reconstruct from the data in nesleveldef.ts
  const RAW_DWORDS: readonly (readonly number[])[] = [
    [0x131313FF, 0x131313FF, 0x4B4B4BFF, 0x4B4B4BFF, 0x4B4B4BFF, 0x4B4B4BFF, 0x4B4B4BFF, 0x4B4B4BFF],
    [0x483B2BFF, 0x2D3B2DFF, 0x131313FF, 0x141414FF, 0x48142DFF, 0x2E2E2EFF, 0x141414FF, 0x484848FF],
    [0x3B3B3BFF, 0x4F4F4FFF, 0x4E4E4EFF, 0x131313FF, 0x4D4D4DFF, 0x3D3D3DFF, 0x131313FF, 0x484848FF],
    [0x483B2BFF, 0x3B3B3BFF, 0x131313FF, 0x4D4D4DFF, 0x3D3D3DFF, 0x3B1313FF, 0x484848FF, 0x484848FF],
  ];
  return RAW_DWORDS[f]?.[gType] ?? 0;
}

/** Draw a tile from the atlas onto a canvas element. */
function drawTileOnCanvas(el: HTMLCanvasElement | null, tileId: number): void {
  if (!el || tileId === 0xff) return;
  const pal = palette.value;
  const src = pal ? getColorizedAtlas(atlas.value, pal) : getAtlasImage(atlas.value);
  if (!src) return;
  el.width = METATILE_SIZE;
  el.height = METATILE_SIZE;
  el.style.width = '48px';
  el.style.height = '48px';
  el.style.imageRendering = 'pixelated';
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const { sx, sy } = metatileRect(tileId);
  ctx.drawImage(src, sx, sy, METATILE_SIZE, METATILE_SIZE, 0, 0, METATILE_SIZE, METATILE_SIZE);
}

function drawRawTileOnCanvas(el: HTMLCanvasElement | null, tileId: number): void {
  if (!el || tileId === 0xff) return;
  const src = getAtlasImage(atlas.value);
  if (!src) return;
  el.width = METATILE_SIZE;
  el.height = METATILE_SIZE;
  el.style.width = '48px';
  el.style.height = '48px';
  el.style.imageRendering = 'pixelated';
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const { sx, sy } = metatileRect(tileId);
  ctx.drawImage(src, sx, sy, METATILE_SIZE, METATILE_SIZE, 0, 0, METATILE_SIZE, METATILE_SIZE);
}

// ─── ObjTile comparison for extended items ─────────────────────────

const objTileComparison = computed(() => {
  const r = rom.value;
  const h = header.value;
  if (!r || !h) return null;
  const w = world.value;

  const results: { vid: number; romTile: number }[] = [];
  for (let vid = 0; vid <= 8; vid++) {
    results.push({
      vid,
      romTile: getObjTile(r, vid, w, h.objectType),
    });
  }
  return results;
});
</script>

<template>
  <div class="min-h-screen bg-[#111] text-white p-6 space-y-6 font-mono text-sm">
    <h1 class="text-xl font-bold">
      Rendering Debug
    </h1>

    <RomLoader
      v-if="!romData"
      @loaded="onLoaded"
    />

    <template v-else>
      <div class="flex items-center gap-4">
        <label>
          Slot:
          <input
            v-model.number="slot"
            type="number"
            min="0"
            max="209"
            class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1"
          >
        </label>
        <span v-if="header">
          gSet={{ header.groundSet }} gType={{ header.groundType }}
          world={{ world }} fx={{ fx }} atlas={{ atlas }}
          dir={{ header.direction === 1 ? 'H' : 'V' }}
          objType={{ header.objectType }}
        </span>
      </div>

      <!-- Ground comparison -->
      <div
        v-if="groundComparison"
        class="space-y-4"
      >
        <h2 class="text-lg font-semibold border-b border-gray-700 pb-1">
          Ground Tiles
        </h2>

        <div class="space-y-1">
          <p>
            Bitmask ROM: {{ groundComparison.romBitmask }}
          </p>
          <p>
            Bitmask static: {{ groundComparison.staticBitmask }}
          </p>
          <p :class="groundComparison.bitmaskMatch ? 'text-green-400' : 'text-red-400'">
            {{ groundComparison.bitmaskMatch ? 'MATCH' : 'MISMATCH' }}
          </p>
        </div>

        <p>
          Active rows: {{ groundComparison.activeRows.map(r => `row ${r.row}=bs${r.bitset}`).join(', ') || 'none' }}
        </p>

        <table class="border-collapse">
          <thead>
            <tr class="text-gray-400">
              <th class="px-3 py-1 text-left">
                Bitset
              </th>
              <th class="px-3 py-1 text-left">
                ROM tile
              </th>
              <th class="px-3 py-1 text-left">
                ROM visual
              </th>
              <th class="px-3 py-1 text-left">
                Static BE
              </th>
              <th class="px-3 py-1 text-left">
                BE visual
              </th>
              <th class="px-3 py-1 text-left">
                Static LE
              </th>
              <th class="px-3 py-1 text-left">
                LE visual
              </th>
              <th class="px-3 py-1 text-left">
                Match?
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="tc in groundComparison.tileComparisons"
              :key="tc.bitset"
            >
              <td class="px-3 py-1">
                {{ tc.bitset }}
              </td>
              <td class="px-3 py-1">
                0x{{ tc.romTileId.toString(16).padStart(2, '0') }}
              </td>
              <td class="px-3 py-1">
                <canvas :ref="(el) => drawTileOnCanvas(el as HTMLCanvasElement, tc.romTileId)" />
              </td>
              <td class="px-3 py-1">
                0x{{ tc.staticBE.toString(16).padStart(2, '0') }}
              </td>
              <td class="px-3 py-1">
                <canvas :ref="(el) => drawTileOnCanvas(el as HTMLCanvasElement, tc.staticBE)" />
              </td>
              <td class="px-3 py-1">
                0x{{ tc.staticLE.toString(16).padStart(2, '0') }}
              </td>
              <td class="px-3 py-1">
                <canvas :ref="(el) => drawTileOnCanvas(el as HTMLCanvasElement, tc.staticLE)" />
              </td>
              <td class="px-3 py-1">
                <span
                  v-if="tc.romTileId === tc.staticBE"
                  class="text-green-400"
                >ROM=BE</span>
                <span
                  v-else-if="tc.romTileId === tc.staticLE"
                  class="text-blue-400"
                >ROM=LE</span>
                <span
                  v-else
                  class="text-red-400"
                >NONE</span>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Raw atlas tiles (no palette) for reference -->
        <h3 class="text-sm text-gray-400">
          Raw atlas (no palette) — first 64 tiles of atlas {{ atlas }}:
        </h3>
        <div class="flex flex-wrap gap-1">
          <div
            v-for="i in 64"
            :key="i - 1"
            class="text-center"
          >
            <canvas :ref="(el) => drawRawTileOnCanvas(el as HTMLCanvasElement, i - 1)" />
            <div class="text-[8px] text-gray-500">
              {{ (i - 1).toString(16).padStart(2, '0') }}
            </div>
          </div>
        </div>
      </div>

      <!-- ObjTile comparison -->
      <div
        v-if="objTileComparison"
        class="space-y-4"
      >
        <h2 class="text-lg font-semibold border-b border-gray-700 pb-1">
          GetObjTile (extended items)
        </h2>
        <table class="border-collapse">
          <thead>
            <tr class="text-gray-400">
              <th class="px-3 py-1 text-left">
                vid
              </th>
              <th class="px-3 py-1 text-left">
                ROM tile
              </th>
              <th class="px-3 py-1 text-left">
                Visual
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="ot in objTileComparison"
              :key="ot.vid"
            >
              <td class="px-3 py-1">
                {{ ot.vid }}
              </td>
              <td class="px-3 py-1">
                0x{{ ot.romTile.toString(16).padStart(2, '0') }}
              </td>
              <td class="px-3 py-1">
                <canvas :ref="(el) => drawTileOnCanvas(el as HTMLCanvasElement, ot.romTile)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
