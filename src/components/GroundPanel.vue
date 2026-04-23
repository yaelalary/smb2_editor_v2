<script setup lang="ts">
/**
 * Ground-zone editor — active when `editor.activeTool === 'ground'`.
 *
 * Vocabulary: we call each groundSet boundary a **zone**. The level is
 * split into zones that cover the travel axis in order; each has a
 * chosen **shape** (one of 32 preset bitmask patterns stored in ROM).
 * Zones can't overlap — the next one just takes over from its start.
 *
 * UX: help at the top, zone list (with realistic thumbnails of the
 * terrain each zone paints), selected-zone controls, and a shape picker
 * grouped into readable categories at the bottom.
 */
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import BasePanel from './common/BasePanel.vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { computeGroundSegments } from '@/rom/ground-pass';
import { physicsForZone, type GroundPhysics } from '@/rom/ground-physics';
import { getBgSet, getBgTile, getWorldGfx } from '@/rom/tile-reader';
import { levelDimensions } from '@/rom/level-layout';
import { readLevelPalette } from '@/rom/palette-reader';
import { getColorizedBgAtlas, bgTileRect, METATILE_SIZE } from '@/assets/metatiles';
import type { LevelBlock, LevelItem } from '@/rom/model';
import { SetLevelFieldCommand } from '@/commands/property-commands';
import {
  SetGroundSetCommand,
  SetGroundTypeCommand,
  MoveGroundSegmentCommand,
  InsertGroundSegmentCommand,
  DeleteGroundSegmentCommand,
} from '@/commands/ground-commands';

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();

/** Selection mirror — the LevelCanvas click handler writes here too. */
const selected = computed({
  get: () => editor.selectedGroundSegment,
  set: (v) => { editor.selectedGroundSegment = v; },
});

const block = computed<LevelBlock | null>(() => {
  void history.revision;
  const b = rom.activeBlock;
  return b ? (b as LevelBlock) : null;
});

const streamZones = computed<LevelItem[]>(() => {
  // Explicit dep on history.revision: block.items is mutated in place by
  // commands (splice/push), and rom.levelMap is a shallowRef so deep
  // mutations don't trigger reactivity. The parent `block` computed reads
  // revision too but returns the same LevelBlock reference on every
  // revision bump, so Vue skips downstream updates (identity comparison).
  // Reading revision here forces this computed to re-run at every command.
  void history.revision;
  const b = block.value;
  if (!b) return [];
  return b.items.filter((it) => it.kind === 'groundSet');
});

const zones = computed(() => {
  void history.revision;
  const b = block.value;
  if (!b) return [];
  return computeGroundSegments(b); // index 0 = header zone (start=0)
});

const axisLength = computed(() => {
  const b = block.value;
  if (!b) return 16;
  const dims = levelDimensions(b);
  return b.header.direction === 1 ? dims.widthTiles : dims.heightTiles;
});

watch(() => rom.activeSlot, () => { selected.value = 'header'; });

function isZoneSelected(zoneIdx: number): boolean {
  if (zoneIdx === 0) return selected.value === 'header';
  return selected.value === streamZones.value[zoneIdx - 1];
}

function pickZone(zoneIdx: number): void {
  if (zoneIdx === 0) { selected.value = 'header'; return; }
  const it = streamZones.value[zoneIdx - 1];
  if (it) selected.value = it;
}

/** Index of the currently selected zone, or 0 when header is selected. */
const selectedZoneIdx = computed<number>(() => {
  const s = selected.value;
  if (s === 'header' || s === null) return 0;
  const idx = streamZones.value.indexOf(s as LevelItem);
  return idx === -1 ? 0 : idx + 1;
});

const selectedZoneShape = computed<number>(() => {
  // Same reactivity trap as streamZones: SetGroundSetCommand reassigns
  // item.sourceBytes to a new Uint8Array, but the item itself (inside
  // a shallowRef chain) isn't reactive, so the shape read here wouldn't
  // update after a pickShape() command. Force re-run on revision bump.
  void history.revision;
  const b = block.value;
  if (!b) return 0;
  const s = selected.value;
  if (s === 'header' || s === null) return b.header.groundSet;
  return ((s as LevelItem).sourceBytes[1] ?? 0) & 0x1f;
});

function zoneStart(zoneIdx: number): number {
  return zones.value[zoneIdx]?.startPos ?? 0;
}

function zoneEnd(zoneIdx: number): number {
  return zones.value[zoneIdx + 1]?.startPos ?? axisLength.value;
}

function zoneLength(zoneIdx: number): number {
  return Math.max(0, zoneEnd(zoneIdx) - zoneStart(zoneIdx));
}

function clampStart(item: LevelItem, wanted: number): number {
  const stream = streamZones.value;
  const idx = stream.indexOf(item);
  const prev = idx > 0 ? stream[idx - 1]! : null;
  const next = idx < stream.length - 1 ? stream[idx + 1]! : null;
  const min = (prev?.absoluteStartPos ?? 0) + 1;
  const max = next ? (next.absoluteStartPos ?? axisLength.value) - 1 : axisLength.value - 1;
  return Math.min(Math.max(wanted, min), max);
}

function nudgeStart(delta: number): void {
  const b = block.value;
  const s = selected.value;
  if (!b || s === 'header' || s === null) return;
  const item = s as LevelItem;
  const clamped = clampStart(item, (item.absoluteStartPos ?? 0) + delta);
  if (clamped === (item.absoluteStartPos ?? 0)) return;
  history.execute(new MoveGroundSegmentCommand(b, item, clamped, rom.activeSlot));
}

function onStartInput(item: LevelItem, raw: string): void {
  const b = block.value;
  if (!b) return;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return;
  const clamped = clampStart(item, n);
  if (clamped === (item.absoluteStartPos ?? 0)) return;
  history.execute(new MoveGroundSegmentCommand(b, item, clamped, rom.activeSlot));
}

/**
 * The "End" of a zone is implicit in the ROM format — it's simply the
 * Start of the NEXT zone (or the level's axis length for the last
 * zone). Editing the End of zone N therefore means moving the Start of
 * zone N+1. This helper returns the next-zone item, or null if the
 * selected zone is the last one (end not editable).
 */
function nextZoneItemOfSelected(): LevelItem | null {
  const idx = selectedZoneIdx.value;
  const stream = streamZones.value;
  // zone[idx]'s end = stream[idx]'s Start (since stream[0] = zone[1] etc.)
  return stream[idx] ?? null;
}

function nudgeEnd(delta: number): void {
  const b = block.value;
  const next = nextZoneItemOfSelected();
  if (!b || !next) return;
  const clamped = clampStart(next, (next.absoluteStartPos ?? 0) + delta);
  if (clamped === (next.absoluteStartPos ?? 0)) return;
  history.execute(new MoveGroundSegmentCommand(b, next, clamped, rom.activeSlot));
}

function onEndInput(raw: string): void {
  const b = block.value;
  const next = nextZoneItemOfSelected();
  if (!b || !next) return;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return;
  const clamped = clampStart(next, n);
  if (clamped === (next.absoluteStartPos ?? 0)) return;
  history.execute(new MoveGroundSegmentCommand(b, next, clamped, rom.activeSlot));
}

function pickShape(shape: number): void {
  const b = block.value;
  const s = selected.value;
  if (!b || s === null) return;
  if (s === 'header') {
    if (b.header.groundSet === shape) return;
    history.execute(new SetLevelFieldCommand(b.header, 'groundSet', shape, rom.activeSlot));
  } else {
    const item = s as LevelItem;
    const current = (item.sourceBytes[1] ?? 0) & 0x1f;
    if (current === shape) return;
    history.execute(new SetGroundSetCommand(b, item, shape, rom.activeSlot));
  }
}

/**
 * Split the currently-selected zone at its midpoint. The new zone
 * inherits the split zone's shape, so the visible terrain doesn't
 * change until the user picks a different shape for the new zone. This
 * is the only way to "add" a zone because the format is segment-based:
 * every new zone must be anchored between two existing boundaries.
 *
 * Returns the number of tiles available in the selected zone; callers
 * use this to disable the button when there's not enough room.
 */
function splitRoom(): number {
  const idx = selectedZoneIdx.value;
  return zoneEnd(idx) - zoneStart(idx);
}

function splitSelectedZone(): void {
  const b = block.value;
  if (!b) return;
  const idx = selectedZoneIdx.value;
  const start = zoneStart(idx);
  const end = zoneEnd(idx);
  const room = end - start;
  if (room < 2) return; // not enough room to split
  // Anchor = the stream item BEFORE which the new zone would normally
  // be appended. If we're splitting Zone 1 (header), the anchor is null
  // (prepend to the stream). Otherwise the anchor is the current zone's
  // own LevelItem.
  const anchorItem = idx === 0 ? null : (streamZones.value[idx - 1] ?? null);
  const newStart = start + Math.max(1, Math.floor(room / 2));
  const inheritedShape = selectedZoneShape.value;
  const inheritedType = groundTypeFor(idx);

  history.execute(
    new InsertGroundSegmentCommand(
      b, anchorItem, newStart, inheritedShape, inheritedType, rom.activeSlot,
    ),
  );
  // Select the freshly-inserted zone so the user can change its shape.
  nextTick(() => {
    const fresh = streamZones.value.find((it) => it.absoluteStartPos === newStart);
    if (fresh) selected.value = fresh;
  });
}

/**
 * Delete the zone at display index `idx` (1-based: idx=0 is the header
 * zone and is never deletable). The stream item corresponding to that
 * display zone is `streamZones[idx - 1]`. After delete, the previous
 * zone's end implicitly extends to where the deleted zone started — no
 * extra command needed, the UI's `zoneEnd()` already reads from the
 * next stream item (or axisLength for the last one).
 */
function deleteZone(idx: number): void {
  const b = block.value;
  if (!b || idx <= 0) return;
  const item = streamZones.value[idx - 1];
  if (!item) return;
  history.execute(new DeleteGroundSegmentCommand(b, item, rom.activeSlot));
  // If the deleted zone was selected, fall back to the header zone so
  // the controls panel has something coherent to display.
  if (selected.value === item) selected.value = 'header';
}

// ─── Realistic thumbnail rendering ─────────────────────────────────

const drawGen = ref(0);
watch(() => [rom.activeSlot, history.revision], () => {
  drawGen.value++;
  nextTick(() => drawGen.value++);
});
onMounted(() => { drawGen.value++; });

function groundTypeFor(zoneIdx: number): number {
  const z = zones.value[zoneIdx];
  return (z?.groundType ?? 0) & 0x07;
}

/**
 * Render a mini terrain preview: runs a single-zone groundPass on a
 * tiny canvas using the actual palette + bgAtlas. This reads like the
 * real in-level terrain, not an abstract bit grid.
 */
function drawShape(el: unknown, shape: number, groundType: number, cellPx = 3): void {
  if (!el) return;
  const canvas = el as HTMLCanvasElement;
  const romData = rom.romData;
  const b = rom.activeBlock;
  if (!romData || !b) return;
  const isH = (b as { header: { direction: number } }).header.direction === 1;
  const palette = readLevelPalette(romData.rom, rom.activeSlot, (b as { header: { palette: number } }).header.palette);
  void drawGen.value;

  const key = `s-${shape}-${groundType}-${isH ? 'h' : 'v'}-${rom.activeSlot}`;
  if (canvas.dataset['drawn'] === key) return;

  const world = Math.floor(rom.activeSlot / 30);
  const gfx = getWorldGfx(romData.rom, world);
  const bgAtlas = getColorizedBgAtlas(gfx, palette);

  const GRID_W = 16;
  const GRID_H = 15;
  canvas.width = (isH ? GRID_W : GRID_H) * cellPx;
  canvas.height = (isH ? GRID_H : GRID_W) * cellPx;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  canvas.style.imageRendering = 'pixelated';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = palette.bgColorCss;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!bgAtlas) {
    // Fallback: green-density bit grid if atlas isn't ready yet.
    const dw = getBgSet(romData.rom, shape & 0x1f, isH);
    for (let i = 0; i < 15; i++) {
      const bitset = (dw >>> (30 - i * 2)) & 0x03;
      if (bitset === 0) continue;
      ctx.fillStyle = bitset === 3 ? '#c8ffc8' : bitset === 2 ? '#80c880' : '#4aa04a';
      for (let j = 0; j < 16; j++) {
        const x = isH ? j : i;
        const y = isH ? i : j;
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
    canvas.dataset['drawn'] = `${key}-fallback`;
    return;
  }

  const dw = getBgSet(romData.rom, shape & 0x1f, isH);
  for (let i = 0; i < 15; i++) {
    const bitset = (dw >>> (30 - i * 2)) & 0x03;
    if (bitset === 0) continue;
    const tileId = getBgTile(romData.rom, bitset, groundType, world, isH);
    if (tileId === 0xff) continue;
    const { sx, sy } = bgTileRect(tileId);
    for (let j = 0; j < 16; j++) {
      const x = isH ? j : i;
      const y = isH ? i : j;
      ctx.drawImage(bgAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE, x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }
  canvas.dataset['drawn'] = key;
}

/**
 * Render a close-up of the single ground tile that `gt` produces in
 * the current level context. Uses bgSet=1 as the representative
 * "solid" density. Shows nothing (BG color only) when the tile ID is
 * 0x00 or 0xFF (empty/invalid — groundTypes 6/7 and some corner cases).
 */
function drawGroundTilePreview(el: unknown, gt: number, scale = 4): void {
  if (!el) return;
  const canvas = el as HTMLCanvasElement;
  const romData = rom.romData;
  const b = rom.activeBlock;
  if (!romData || !b) return;
  void drawGen.value;

  const isH = (b as { header: { direction: number } }).header.direction === 1;
  const palette = readLevelPalette(
    romData.rom,
    rom.activeSlot,
    (b as { header: { palette: number } }).header.palette,
  );
  if (!palette) return;
  const world = Math.floor(rom.activeSlot / 30);
  const gfx = getWorldGfx(romData.rom, world);

  const tileId = getBgTile(romData.rom, 1, gt, world, isH);
  const key = `gtp:${gt}:${tileId}:${gfx}:${palette.nesIndices.join(',')}`;
  if (canvas.dataset['drawn'] === key) return;

  const bgAtlas = getColorizedBgAtlas(gfx, palette);
  if (!bgAtlas) return;

  const size = METATILE_SIZE * scale;
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.style.imageRendering = 'pixelated';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = palette.bgColorCss;
  ctx.fillRect(0, 0, size, size);

  if (tileId !== 0xff && tileId !== 0) {
    const { sx, sy } = bgTileRect(tileId);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      bgAtlas,
      sx, sy, METATILE_SIZE, METATILE_SIZE,
      0, 0, size, size,
    );
  }
  canvas.dataset['drawn'] = key;
}

/**
 * Runtime physics the SELECTED zone would have if its `groundType` were
 * set to `gt`. Used to build the groundType dropdown's option labels so
 * the user sees "0 · solid", "1 · quicksand", etc. based on the current
 * (world, objectType, shape) context.
 */
function physicsForGroundType(gt: number): GroundPhysics {
  void history.revision;
  const b = block.value;
  const romData = rom.romData;
  if (!b || !romData) return 'solid';
  const world = Math.floor(rom.activeSlot / 30);
  const isH = (b as { header: { direction: number } }).header.direction === 1;
  const objectType = (b as { header: { objectType: number } }).header.objectType;
  return physicsForZone(romData.rom, world, objectType, selectedZoneShape.value, gt, isH);
}

function groundTypeOptionLabel(gt: number): string {
  const p = physicsForGroundType(gt);
  return p === 'solid' ? `${gt} · solid` : `${gt} · ${p}`;
}

function onGroundTypeChange(raw: string): void {
  const b = block.value;
  const s = selected.value;
  if (!b || s === null) return;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return;
  const clamped = Math.max(0, Math.min(7, n));
  if (s === 'header') {
    if (b.header.groundType === clamped) return;
    // If the first stream zone has no companion groundType opcode, our
    // header change would leak to it via carry-forward. Pin it first
    // with its current effective type so the change stays local to zone 1.
    const firstStream = streamZones.value[0];
    if (firstStream) {
      const arrIdx = b.items.indexOf(firstStream);
      const companion = b.items[arrIdx + 1];
      if (!companion || companion.kind !== 'groundType') {
        const currentType = zones.value[1]?.groundType ?? 0;
        history.execute(
          new SetGroundTypeCommand(b, firstStream, currentType, rom.activeSlot),
        );
      }
    }
    history.execute(new SetLevelFieldCommand(b.header, 'groundType', clamped, rom.activeSlot));
  } else {
    const item = s as LevelItem;
    history.execute(new SetGroundTypeCommand(b, item, clamped, rom.activeSlot));
  }
}

/**
 * Grouped shape picker — collects the 32 presets under intent
 * headings. Any index not mapped here lands under "Others" (32-item
 * coverage guarantee).
 */
const SHAPE_GROUPS: ReadonlyArray<{ label: string; ids: ReadonlyArray<number> }> = [
  { label: 'Sols plats',       ids: [0, 1, 2, 3, 4, 5] },
  { label: 'Hauts murs / sols', ids: [6, 7] },
  { label: 'Trou (pas de sol)', ids: [8] },
  { label: 'Colonnes & piliers', ids: [10, 11, 12, 13] },
  { label: 'Motifs mixtes',     ids: [9, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
];

/**
 * Runtime physics of the zone at display index `idx` (0 = header).
 * In SMB2, physics comes from the zone's `groundType` (not from the
 * shape), so this is a per-ZONE attribute, not per-shape. Used to
 * badge each zone in the list below with its runtime behavior.
 */
function zonePhysics(idx: number): GroundPhysics {
  void history.revision; // see streamZones — shallowRef reactivity
  const b = block.value;
  const romData = rom.romData;
  const seg = zones.value[idx];
  if (!b || !romData || !seg) return 'solid';
  const world = Math.floor(rom.activeSlot / 30);
  const isH = (b as { header: { direction: number } }).header.direction === 1;
  const objectType = (b as { header: { objectType: number } }).header.objectType;
  return physicsForZone(romData.rom, world, objectType, seg.groundSet, seg.groundType, isH);
}
</script>

<template>
  <BasePanel title="Ground">
    <div
      v-if="!block"
      class="p-3 text-xs text-ink-muted"
    >
      Select a level to edit ground.
    </div>

    <template v-else>
      <!-- Help -->
      <div class="px-3 py-2 text-[11px] leading-snug text-ink-muted border-b border-panel-border">
        The ground is split into <b>zones</b>. Each zone has a <b>shape</b>
        (flat, wall, hole…). Click a zone below, then pick a shape.
      </div>

      <!-- Zone list -->
      <div>
        <div
          v-for="(_z, idx) in zones"
          :key="idx === 0 ? 'zone-header' : (streamZones[idx - 1] ?? idx)"
          :class="[
            'flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2',
            isZoneSelected(idx)
              ? 'bg-accent/10 border-accent'
              : 'hover:bg-panel-subtle border-transparent',
          ]"
          @click="pickZone(idx)"
        >
          <canvas
            :key="`zone-${idx}-${drawGen}`"
            :ref="(el) => drawShape(el, zoneStart(idx) === 0 ? zones[0]?.groundSet ?? 0 : (streamZones[idx - 1]?.sourceBytes[1] ?? 0) & 0x1f, groundTypeFor(idx), 3)"
            class="shrink-0 rounded-sm border border-black/30"
          />
          <div class="flex-1 min-w-0">
            <div class="text-xs font-semibold text-ink flex items-center gap-1.5">
              <span>Zone {{ idx + 1 }}</span>
              <span
                v-if="idx === 0"
                class="text-[9px] text-ink-muted font-normal"
              >(start)</span>
              <span
                v-if="zonePhysics(idx) !== 'solid'"
                class="text-[9px] font-bold leading-none px-1 py-px rounded-sm text-black"
                :class="zonePhysics(idx) === 'diggable' ? 'bg-amber-500' : 'bg-cyan-500'"
                :title="`Runtime physics: ${zonePhysics(idx)}`"
              >
                {{ zonePhysics(idx) === 'diggable' ? 'DIG' : 'QS' }}
              </span>
            </div>
            <div class="text-[10px] text-ink-muted">
              tile {{ zoneStart(idx) }} → {{ zoneEnd(idx) }} · {{ zoneLength(idx) }} tiles
            </div>
          </div>
          <button
            v-if="idx > 0"
            type="button"
            class="shrink-0 text-ink-muted hover:text-status-danger px-1 text-lg leading-none"
            title="Delete this zone"
            @click.stop="deleteZone(idx)"
          >
            ×
          </button>
        </div>

        <button
          type="button"
          :disabled="splitRoom() < 2"
          :class="[
            'w-full px-3 py-2 text-xs font-semibold transition-colors text-left border-t border-panel-border',
            splitRoom() < 2
              ? 'text-ink-muted/50 cursor-not-allowed'
              : 'text-accent hover:bg-accent/10',
          ]"
          :title="splitRoom() < 2
            ? 'Not enough room — the selected zone is too narrow to split.'
            : 'Cut the selected zone in half and add a new zone in the second half.'"
          @click="splitSelectedZone"
        >
          ✂ Split this zone in two
        </button>
      </div>

      <!-- Selected zone position controls -->
      <div class="px-3 py-2 bg-panel-subtle border-t border-panel-border space-y-2">
        <div class="text-[10px] text-ink-muted uppercase font-semibold tracking-wide">
          Zone {{ selectedZoneIdx + 1 }} position
        </div>

        <!-- Start -->
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-ink-muted w-12 shrink-0">Starts</span>
          <template v-if="selectedZoneIdx === 0">
            <input
              type="number"
              value="0"
              disabled
              class="flex-1 px-2 py-1 rounded bg-panel border border-panel-border
                     text-xs font-mono text-center text-ink-muted/60 cursor-not-allowed"
              title="The first zone always starts at tile 0 (level's beginning)."
            >
          </template>
          <template v-else>
            <button
              type="button"
              class="px-2 py-1 rounded bg-panel border border-panel-border hover:border-accent"
              title="Move start earlier"
              @click="nudgeStart(-1)"
            >
              ‹
            </button>
            <input
              type="number"
              :min="1"
              :max="axisLength - 1"
              :value="(selected as LevelItem).absoluteStartPos ?? 0"
              class="flex-1 px-2 py-1 rounded bg-panel border border-panel-border
                     text-xs font-mono text-center focus:outline-none focus:border-accent"
              @change="(e) => onStartInput(selected as LevelItem, (e.target as HTMLInputElement).value)"
            >
            <button
              type="button"
              class="px-2 py-1 rounded bg-panel border border-panel-border hover:border-accent"
              title="Move start later"
              @click="nudgeStart(1)"
            >
              ›
            </button>
          </template>
        </div>

        <!-- End -->
        <div class="flex items-center gap-1">
          <span class="text-[10px] text-ink-muted w-12 shrink-0">Ends</span>
          <template v-if="!nextZoneItemOfSelected()">
            <input
              type="number"
              :value="axisLength"
              disabled
              class="flex-1 px-2 py-1 rounded bg-panel border border-panel-border
                     text-xs font-mono text-center text-ink-muted/60 cursor-not-allowed"
              title="The last zone always ends at the level's boundary."
            >
          </template>
          <template v-else>
            <button
              type="button"
              class="px-2 py-1 rounded bg-panel border border-panel-border hover:border-accent"
              title="Shrink this zone (move end earlier)"
              @click="nudgeEnd(-1)"
            >
              ‹
            </button>
            <input
              type="number"
              :min="1"
              :max="axisLength"
              :value="nextZoneItemOfSelected()?.absoluteStartPos ?? axisLength"
              class="flex-1 px-2 py-1 rounded bg-panel border border-panel-border
                     text-xs font-mono text-center focus:outline-none focus:border-accent"
              @change="(e) => onEndInput((e.target as HTMLInputElement).value)"
            >
            <button
              type="button"
              class="px-2 py-1 rounded bg-panel border border-panel-border hover:border-accent"
              title="Grow this zone (move end later)"
              @click="nudgeEnd(1)"
            >
              ›
            </button>
          </template>
        </div>

        <div class="text-[10px] text-ink-muted/80 italic">
          Editing the end actually moves the next zone's start — zones
          are always adjacent (no gaps, no overlaps).
        </div>

        <!-- Ground type — controls BOTH the rendered tile AND physics.
             Each button shows a realistic preview of what the zone
             would look like with that type (same shape, varying type). -->
        <div class="pt-1 space-y-1">
          <span class="text-[10px] text-ink-muted">Type</span>
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="gt in 8"
              :key="gt - 1"
              type="button"
              :title="groundTypeOptionLabel(gt - 1)"
              :class="[
                'relative flex items-center justify-center p-0.5 rounded border transition-colors',
                'hover:bg-panel-subtle cursor-pointer',
                groundTypeFor(selectedZoneIdx) === gt - 1
                  ? 'border-accent bg-accent/10'
                  : 'border-panel-border hover:border-accent/50',
              ]"
              @click="onGroundTypeChange(String(gt - 1))"
            >
              <canvas
                :key="`gt-${gt - 1}-${drawGen}`"
                :ref="(el) => drawGroundTilePreview(el, gt - 1, 3)"
                class="rounded-sm"
              />
              <span
                class="absolute top-0 left-0 text-[8px] font-bold leading-none px-1 py-px
                       rounded-br-sm bg-black/60 text-white"
              >
                {{ gt - 1 }}
              </span>
              <span
                v-if="physicsForGroundType(gt - 1) !== 'solid'"
                class="absolute bottom-0 right-0 text-[8px] font-bold leading-none px-1 py-px
                       rounded-tl-sm text-black"
                :class="physicsForGroundType(gt - 1) === 'diggable' ? 'bg-amber-500' : 'bg-cyan-500'"
              >
                {{ physicsForGroundType(gt - 1) === 'diggable' ? 'DIG' : 'QS' }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Shape picker -->
      <div class="border-t border-panel-border">
        <div
          class="px-3 py-2 text-xs font-semibold text-ink-muted uppercase tracking-wide
                 bg-panel-subtle"
        >
          Shape
          <span class="text-ink-muted font-normal lowercase">— click to apply to the selected zone</span>
        </div>
        <div
          v-for="group in SHAPE_GROUPS"
          :key="group.label"
          class="px-2 py-2 border-t border-panel-border/50"
        >
          <div class="text-[10px] text-ink-muted uppercase tracking-wide mb-1 px-1">
            {{ group.label }}
          </div>
          <div class="grid grid-cols-4 gap-1">
            <button
              v-for="shape in group.ids"
              :key="shape"
              type="button"
              :title="`Shape #${shape}`"
              :class="[
                'flex items-center justify-center p-0.5 rounded border transition-colors',
                'hover:bg-panel-subtle cursor-pointer',
                selectedZoneShape === shape
                  ? 'border-accent bg-accent/10'
                  : 'border-panel-border hover:border-accent/50',
              ]"
              @click="pickShape(shape)"
            >
              <canvas
                :key="`shape-${shape}-${drawGen}`"
                :ref="(el) => drawShape(el, shape, groundTypeFor(selectedZoneIdx), 3)"
                class="rounded-sm"
              />
            </button>
          </div>
        </div>
      </div>
    </template>
  </BasePanel>
</template>
