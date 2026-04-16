<script setup lang="ts">
/**
 * Read-only level canvas — Unit 6.
 *
 * Renders the active level's items as colored rectangles on a tile
 * grid. Each item is positioned using the cumulative-cursor logic
 * ported from `loginsinex/smb2` (see `computeItemPositions`).
 *
 * v0.1 rendering is rectangles + labels, NOT sprite tiles. The mapping
 * from item-ID → CHR tile(s) requires ~1870 lines of lookup tables
 * from `nesleveldef.cpp` which will be ported in Phase 2 when editing
 * lands. The rectangles prove that the parser-to-canvas pipeline and
 * the position computation are correct.
 *
 * Canvas dimensions are derived from the level header (direction ×
 * length in pages). HiDPI scaling via devicePixelRatio is applied so
 * tiles stay crisp on retina displays.
 */
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRomStore } from '@/stores/rom';
import {
  computeItemPositions,
  levelDimensions,
  ITEM_COLORS,
  type PositionedItem,
} from '@/rom/level-layout';
import type { LevelBlock } from '@/rom/model';
import { ITEM_DIM, getItemDimTiles } from '@/rom/nesleveldef';
import {
  getAtlasImage,
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';

const TILE_PX = 16; // CSS pixels per tile — matches METATILE_SIZE
/**
 * Which atlas to use. For now we use atlas 0 (overworld A) as default.
 * The proper atlas-per-level mapping depends on the objectType/groundSet
 * and will be refined once we understand the C++ tool's template
 * selection logic. Using atlas 0 gives correct sprites for most
 * overworld levels.
 */
const DEFAULT_ATLAS_INDEX = 0;

const rom = useRomStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);

function draw(canvas: HTMLCanvasElement, block: LevelBlock): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const { widthTiles, heightTiles } = levelDimensions(block);
  const cssW = widthTiles * TILE_PX;
  const cssH = heightTiles * TILE_PX;

  // Size the canvas for HiDPI.
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background: dark grid.
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid lines (every tile).
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= widthTiles; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_PX, 0);
    ctx.lineTo(x * TILE_PX, cssH);
    ctx.stroke();
  }
  for (let y = 0; y <= heightTiles; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_PX);
    ctx.lineTo(cssW, y * TILE_PX);
    ctx.stroke();
  }

  // Page separators (every 16 tiles horizontally or 15 vertically).
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  if (block.header.direction === 1) {
    // Horizontal: pages are 16 tiles wide.
    for (let p = 1; p <= block.header.length; p++) {
      const px = p * 16 * TILE_PX;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssH);
      ctx.stroke();
    }
  } else {
    // Vertical: pages are 15 tiles tall.
    for (let p = 1; p <= block.header.length; p++) {
      const py = p * 15 * TILE_PX;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(cssW, py);
      ctx.stroke();
    }
  }

  // Items.
  const positioned = computeItemPositions(block);
  for (const pi of positioned) {
    drawItem(ctx, pi, block);
  }

  // Info overlay — top-left.
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, 180, 28);
  ctx.fillStyle = '#ccc';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(
    `${widthTiles}×${heightTiles} tiles · ${positioned.length} items · ${block.header.direction === 1 ? 'horiz' : 'vert'}`,
    6,
    18,
  );
}

/**
 * Resolve the primary metatile ID for a raw item ID byte.
 *
 * Items 0-47: direct index into ITEM_DIM (fixed-size items).
 * Items 48+: packed as (baseType | size). baseType = (id-48)>>4 indexes
 * into SITEM_DIM[fx][objectType]; size is (id-48)&0x0F.
 *
 * Returns the `topleft` metatile ID, or null if the entry is transparent.
 */
function resolveMetatileId(
  rawId: number,
  fx: number,
  objectType: number,
): number | null {
  if (rawId < 0) return null;

  if (rawId < 48) {
    const dim = ITEM_DIM[rawId];
    const tile = dim?.[0];
    return tile !== undefined && tile !== 0xff ? tile : null;
  }

  // Packed variable-size item: baseType in high nibble, size in low.
  const baseType = (rawId - 48) >> 4;
  const tiles = getItemDimTiles(baseType + 48, fx, objectType);
  const tile = tiles[0];
  return tile !== undefined && tile !== 0xff ? tile : null;
}

function drawItem(
  ctx: CanvasRenderingContext2D,
  pi: PositionedItem,
  block: LevelBlock,
): void {
  const x = pi.tileX * TILE_PX;
  const y = pi.tileY * TILE_PX;

  // Try to draw the actual metatile sprite from the atlas.
  const atlas = getAtlasImage(DEFAULT_ATLAS_INDEX);
  const rawId =
    pi.item.sourceBytes.byteLength > 1 ? pi.item.sourceBytes[1]! : -1;

  // fx=0 as default; proper fx derivation from groundSet will come later.
  const tileId = resolveMetatileId(rawId, 0, block.header.objectType);

  if (atlas && tileId !== null) {
    const { sx, sy } = metatileRect(tileId);
    ctx.drawImage(
      atlas,
      sx,
      sy,
      METATILE_SIZE,
      METATILE_SIZE,
      x,
      y,
      TILE_PX,
      TILE_PX,
    );
    return; // sprite drawn, skip rectangle fallback
  }

  // Fallback: colored rectangle (for items not in the lookup table,
  // entrances without a primary tile, or when atlas isn't loaded yet).
  const color = ITEM_COLORS[pi.item.kind] ?? '#666';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.fillRect(x + 1, y + 1, TILE_PX - 2, TILE_PX - 2);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TILE_PX - 1, TILE_PX - 1);

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pi.label, x + TILE_PX / 2, y + TILE_PX / 2, TILE_PX - 4);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function redraw(): void {
  const canvas = canvasRef.value;
  const block = rom.activeBlock;
  if (!canvas || !block) return;
  draw(canvas, block as LevelBlock);
}

// Redraw on slot change or mount.
watch(() => rom.activeSlot, redraw);
onMounted(async () => {
  // Pre-load atlas images, then draw with real sprites.
  await preloadAllAtlases();
  redraw();
});

// DPR change (e.g., user moves window between displays).
const dprMedia = window.matchMedia(
  `(resolution: ${window.devicePixelRatio}dppx)`,
);
function onDprChange(): void {
  redraw();
}
onMounted(() => dprMedia.addEventListener('change', onDprChange));
onUnmounted(() => dprMedia.removeEventListener('change', onDprChange));
</script>

<template>
  <div class="relative h-full overflow-auto bg-[#111]">
    <canvas
      ref="canvasRef"
      class="block [image-rendering:pixelated]"
    />
    <p
      v-if="!rom.activeBlock"
      class="absolute inset-0 flex items-center justify-center text-ink-muted text-sm"
    >
      Select a level from the list
    </p>
  </div>
</template>
