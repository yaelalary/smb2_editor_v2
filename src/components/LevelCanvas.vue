<script setup lang="ts">
/**
 * Interactive level canvas — Unit 6 (view) + Unit 10 (editing).
 *
 * Renders the active level + handles:
 *   - Drop from TileLibrary → PlaceTileCommand
 *   - Click → select item
 *   - Delete/Backspace → DeleteItemCommand
 *   - Drag selected item → MoveItemCommand
 */
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import { useRomStore } from '@/stores/rom';
import { useHistoryStore } from '@/stores/history';
import { useEditorStore } from '@/stores/editor';
import { levelDimensions, ITEM_COLORS } from '@/rom/level-layout';
import { readLevelPalette } from '@/rom/palette-reader';
import type { LevelBlock, LevelItem, EnemyBlock, EnemyItem } from '@/rom/model';
import { ENEMY_DIM } from '@/rom/nesleveldef';
import { DRAG_MIME, ENEMY_DRAG_MIME } from '@/rom/item-categories';
import { PlaceTileCommand, DeleteItemCommand, MoveItemCommand } from '@/commands/tile-commands';
import { PlaceEnemyCommand, DeleteEnemyCommand } from '@/commands/enemy-commands';
import { renderItem, renderGround } from '@/rom/item-renderer';
import type { RenderedTile } from '@/rom/item-renderer';
import {
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
  getColorizedAtlas,
} from '@/assets/metatiles';
import type { LevelPalette } from '@/rom/palette-reader';

const TILE_PX = 16;
const ENEMY_ATLAS_INDEX = 8;

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const selectedItem = ref<LevelItem | null>(null);
const selectedEnemy = ref<{ enemy: EnemyItem; pageIndex: number } | null>(null);

// Ghost position for drop preview.
const ghostTile = ref<{ x: number; y: number } | null>(null);

const block = computed<LevelBlock | null>(() => {
  void history.revision;
  const b = rom.activeBlock;
  return b ? (b as LevelBlock) : null;
});

// ─── Coordinate helpers ─────────────────────────────────────────────

function tileFromEvent(e: MouseEvent): { x: number; y: number } | null {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / TILE_PX);
  const y = Math.floor((e.clientY - rect.top) / TILE_PX);
  return { x, y };
}

function hitTestTile(tileX: number, tileY: number): LevelItem | null {
  const b = block.value;
  if (!b) return null;
  for (const item of b.items) {
    if (item.tileX === tileX && item.tileY === tileY) return item;
  }
  return null;
}

function hitTestEnemy(tileX: number, tileY: number): { enemy: EnemyItem; pageIndex: number } | null {
  const eb = getEnemyBlock();
  if (!eb) return null;
  for (let pageIdx = 0; pageIdx < eb.pages.length; pageIdx++) {
    const page = eb.pages[pageIdx]!;
    for (const enemy of page.enemies) {
      const ex = pageIdx * 16 + enemy.x;
      const ey = enemy.y;
      if (ex === tileX && ey === tileY) {
        return { enemy, pageIndex: pageIdx };
      }
    }
  }
  return null;
}

function getEnemyBlock(): EnemyBlock | null {
  const map = rom.enemyMap;
  if (!map) return null;
  const idx = map.slotToBlock[rom.activeSlot];
  if (idx === undefined) return null;
  return (map.blocks[idx] as EnemyBlock) ?? null;
}

// ─── Drop from TileLibrary or EnemyLibrary ──────────────────────────

function onDragOver(e: DragEvent): void {
  const types = e.dataTransfer?.types;
  if (!types?.includes(DRAG_MIME) && !types?.includes(ENEMY_DRAG_MIME)) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'copy';
  const tile = tileFromEvent(e);
  ghostTile.value = tile;
  redraw();
}

function onDragLeave(): void {
  ghostTile.value = null;
  redraw();
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  ghostTile.value = null;
  if (!e.dataTransfer) return;

  const tile = tileFromEvent(e);
  if (!tile) return;

  // Enemy drop?
  const enemyRaw = e.dataTransfer.getData(ENEMY_DRAG_MIME);
  if (enemyRaw) {
    const eb = getEnemyBlock();
    if (!eb) return;
    try {
      const payload = JSON.parse(enemyRaw) as { enemyId: number };
      history.execute(
        new PlaceEnemyCommand(eb, tile.x, tile.y, payload.enemyId, rom.activeSlot),
      );
    } catch { /* ignore bad payload */ }
    redraw();
    return;
  }

  // Tile drop.
  const tileRaw = e.dataTransfer.getData(DRAG_MIME);
  if (tileRaw) {
    const b = block.value;
    if (!b) return;
    try {
      const payload = JSON.parse(tileRaw) as { itemId: number };
      history.execute(
        new PlaceTileCommand(b, tile.x, tile.y, payload.itemId, rom.activeSlot),
      );
    } catch { /* ignore bad payload */ }
    redraw();
  }
}

// ─── Click to select ────────────────────────────────────────────────

let mouseDownPos: { x: number; y: number } | null = null;

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return; // left button only
  mouseDownPos = tileFromEvent(e);
}

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 0) return;
  const upPos = tileFromEvent(e);
  if (!upPos || !mouseDownPos) {
    mouseDownPos = null;
    return;
  }

  const moved = upPos.x !== mouseDownPos.x || upPos.y !== mouseDownPos.y;

  if (editor.activeTool === 'enemies') {
    // Enemy mode: interact with enemies.
    if (
      selectedEnemy.value &&
      moved &&
      (selectedEnemy.value.enemy.x + selectedEnemy.value.pageIndex * 16) === mouseDownPos.x &&
      selectedEnemy.value.enemy.y === mouseDownPos.y
    ) {
      // TODO: MoveEnemyCommand (cross-page move is complex, skip for now)
      mouseDownPos = null;
      return;
    }
    // Click to select/deselect enemy.
    const hitE = hitTestEnemy(upPos.x, upPos.y);
    selectedEnemy.value = hitE;
    selectedItem.value = null;
    mouseDownPos = null;
    redraw();
    return;
  }

  // Tile mode: interact with tiles.
  if (
    selectedItem.value &&
    moved &&
    selectedItem.value.tileX === mouseDownPos.x &&
    selectedItem.value.tileY === mouseDownPos.y
  ) {
    const b = block.value;
    if (b) {
      history.execute(
        new MoveItemCommand(b, selectedItem.value, upPos.x, upPos.y, rom.activeSlot),
      );
    }
    mouseDownPos = null;
    redraw();
    return;
  }

  const hit = hitTestTile(upPos.x, upPos.y);
  selectedItem.value = hit;
  selectedEnemy.value = null;
  mouseDownPos = null;
  redraw();
}

// ─── Delete key ─────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();

    // Delete selected enemy?
    if (selectedEnemy.value) {
      const eb = getEnemyBlock();
      if (eb) {
        history.execute(
          new DeleteEnemyCommand(eb, selectedEnemy.value.pageIndex, selectedEnemy.value.enemy, rom.activeSlot),
        );
        selectedEnemy.value = null;
        redraw();
      }
      return;
    }

    // Delete selected tile item?
    const item = selectedItem.value;
    const b = block.value;
    if (item && b) {
      history.execute(new DeleteItemCommand(b, item, rom.activeSlot));
      selectedItem.value = null;
      redraw();
    }
  }
}

// ─── Drawing ────────────────────────────────────────────────────────

/**
 * Draw a single rendered tile on the canvas using the palette-colorized
 * atlas. This is the web equivalent of the C++ DrawGamma/DrawGrGamma.
 */
function blitTile(
  ctx: CanvasRenderingContext2D,
  tile: RenderedTile,
  palette: LevelPalette | null,
): void {
  const src = palette
    ? getColorizedAtlas(tile.atlasIndex, palette)
    : null;
  if (!src) return;
  const { sx, sy } = metatileRect(tile.tileId);
  ctx.drawImage(
    src, sx, sy, METATILE_SIZE, METATILE_SIZE,
    tile.x * TILE_PX, tile.y * TILE_PX, TILE_PX, TILE_PX,
  );
}

/**
 * Draw ground tiles from the header's default groundSet/groundType.
 * Uses renderGround() which reads tile IDs from ROM per-world,
 * matching the C++ DrawGroundEx.
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  b: LevelBlock,
  widthTiles: number,
  heightTiles: number,
  palette: LevelPalette | null,
): void {
  const romData = rom.romData;
  if (!romData) return;

  const tiles = renderGround(
    romData.rom, rom.activeSlot, b.header,
    widthTiles, heightTiles,
    b.header.groundSet, b.header.groundType, 0, 0,
  );
  for (const t of tiles) blitTile(ctx, t, palette);
}

/**
 * Draw a level item using the full multi-tile renderer ported from C++.
 * Falls back to a colored rectangle with hex label if no tiles produced.
 */
function drawItemOnCanvas(
  ctx: CanvasRenderingContext2D,
  item: LevelItem,
  isSelected: boolean,
  palette: LevelPalette | null,
): void {
  if (item.tileX < 0 || item.tileY < 0) return;

  const romData = rom.romData;
  const tiles: RenderedTile[] = romData
    ? renderItem(romData.rom, item, rom.activeSlot, block.value!.header)
    : [];

  if (tiles.length > 0) {
    for (const t of tiles) blitTile(ctx, t, palette);
  } else {
    // Fallback: colored rectangle with hex ID
    const x = item.tileX * TILE_PX;
    const y = item.tileY * TILE_PX;
    const color = ITEM_COLORS[item.kind] ?? '#666';
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
    const label = item.itemId >= 0 ? item.itemId.toString(16).toUpperCase() : '?';
    ctx.fillText(label, x + TILE_PX / 2, y + TILE_PX / 2, TILE_PX - 4);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Selection ring — covers all tiles of the item.
  if (isSelected) {
    if (tiles.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const t of tiles) {
        if (t.x < minX) minX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.x > maxX) maxX = t.x;
        if (t.y > maxY) maxY = t.y;
      }
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        minX * TILE_PX, minY * TILE_PX,
        (maxX - minX + 1) * TILE_PX, (maxY - minY + 1) * TILE_PX,
      );
    } else {
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.strokeRect(item.tileX * TILE_PX, item.tileY * TILE_PX, TILE_PX, TILE_PX);
    }
  }
}

function draw(canvas: HTMLCanvasElement, b: LevelBlock): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const { widthTiles, heightTiles } = levelDimensions(b);
  const cssW = widthTiles * TILE_PX;
  const cssH = heightTiles * TILE_PX;

  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background color from the level's NES palette (palette 0, color 0).
  // Read dynamically from the ROM — no hardcoding.
  const romData = rom.romData;
  const palette = romData
    ? readLevelPalette(romData.rom, rom.activeSlot, b.header.palette)
    : null;
  ctx.fillStyle = palette?.bgColorCss ?? '#1a1a2e';
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid (subtle, works on both light and dark backgrounds).
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
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

  // Page separators.
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  if (b.header.direction === 1) {
    for (let p = 1; p <= b.header.length; p++) {
      const px = p * 16 * TILE_PX;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssH);
      ctx.stroke();
    }
  } else {
    for (let p = 1; p <= b.header.length; p++) {
      const py = p * 15 * TILE_PX;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(cssW, py);
      ctx.stroke();
    }
  }

  // Ground rendering — reads tile IDs from ROM per-world.
  drawGround(ctx, b, widthTiles, heightTiles, palette);

  // Items — full multi-tile rendering ported from C++ Draw*ObjectEx.
  for (const item of b.items) {
    drawItemOnCanvas(ctx, item, item === selectedItem.value, palette);
  }

  // Enemy overlay (also palette-colorized).
  if (editor.showEnemies) {
    const enemyBlock = getEnemyBlock();
    const enemyAtlasSrc = palette
      ? getColorizedAtlas(ENEMY_ATLAS_INDEX, palette)
      : null;
    if (enemyBlock && enemyAtlasSrc) {
      for (let pageIdx = 0; pageIdx < enemyBlock.pages.length; pageIdx++) {
        const page = enemyBlock.pages[pageIdx]!;
        for (const enemy of page.enemies) {
          const ex = (pageIdx * 16 + enemy.x) * TILE_PX;
          const ey = enemy.y * TILE_PX;
          const dim = ENEMY_DIM[enemy.id];
          const spriteId = dim?.[0];
          if (spriteId !== undefined && spriteId !== 0xff) {
            const { sx, sy } = metatileRect(spriteId);
            ctx.drawImage(enemyAtlasSrc, sx, sy, METATILE_SIZE, METATILE_SIZE, ex, ey, TILE_PX, TILE_PX);
          } else {
            ctx.fillStyle = 'rgba(255,80,80,0.6)';
            ctx.fillRect(ex + 1, ey + 1, TILE_PX - 2, TILE_PX - 2);
          }
          // Selection ring for enemies.
          if (selectedEnemy.value?.enemy === enemy) {
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(ex, ey, TILE_PX, TILE_PX);
          }
        }
      }
    }
  }

  // Drop ghost preview.
  const ghost = ghostTile.value;
  if (ghost) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(ghost.x * TILE_PX, ghost.y * TILE_PX, TILE_PX, TILE_PX);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(ghost.x * TILE_PX + 0.5, ghost.y * TILE_PX + 0.5, TILE_PX - 1, TILE_PX - 1);
    ctx.setLineDash([]);
  }

  // Info overlay.
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 220, 28);
  ctx.fillStyle = '#fff';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(
    `${widthTiles}×${heightTiles} tiles · ${b.items.filter(i => i.tileX >= 0).length} items · ${b.header.direction === 1 ? 'horiz' : 'vert'}`,
    6,
    18,
  );
}

function redraw(): void {
  const canvas = canvasRef.value;
  const b = block.value;
  if (!canvas || !b) return;
  draw(canvas, b);
}

// Clear selection when switching levels.
watch(() => rom.activeSlot, () => {
  selectedItem.value = null;
  redraw();
});
watch(() => history.revision, redraw);
onMounted(async () => {
  await preloadAllAtlases();
  redraw();
});

const dprMedia = window.matchMedia(
  `(resolution: ${window.devicePixelRatio}dppx)`,
);
onMounted(() => dprMedia.addEventListener('change', redraw));
onUnmounted(() => dprMedia.removeEventListener('change', redraw));
</script>

<template>
  <div
    class="relative h-full overflow-auto bg-[#111]"
    tabindex="0"
    @keydown="onKeyDown"
  >
    <canvas
      ref="canvasRef"
      class="block [image-rendering:pixelated]"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @mousedown="onMouseDown"
      @mouseup="onMouseUp"
    />
    <p
      v-if="!rom.activeBlock"
      class="absolute inset-0 flex items-center justify-center text-ink-muted text-sm"
    >
      Select a level from the list
    </p>
  </div>
</template>
