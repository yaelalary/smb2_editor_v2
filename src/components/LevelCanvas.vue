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
import { levelDimensions, ITEM_COLORS, getFxForSlot } from '@/rom/level-layout';
import { GROUND_SET_H, GROUND_SET_V, GROUND_TYPE_H, GROUND_TYPE_V } from '@/rom/nesleveldef';
import type { LevelBlock, LevelItem, EnemyBlock, EnemyItem } from '@/rom/model';
import { ITEM_DIM, getItemDimTiles, ENEMY_DIM } from '@/rom/nesleveldef';
import { DRAG_MIME, ENEMY_DRAG_MIME } from '@/rom/item-categories';
import { PlaceTileCommand, DeleteItemCommand, MoveItemCommand } from '@/commands/tile-commands';
import { PlaceEnemyCommand } from '@/commands/enemy-commands';
import {
  getAtlasImage,
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
} from '@/assets/metatiles';

const TILE_PX = 16;
/**
 * Atlas 4 is the ITEM atlas (interior/special). The C++ GetSingDim
 * sets type=4 for virtually all items. Atlases 0-3 are for ground tiles.
 */
const ITEM_ATLAS_INDEX = 4;
const ENEMY_ATLAS_INDEX_C = 8;

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

function hitTest(tileX: number, tileY: number): LevelItem | null {
  const b = block.value;
  if (!b) return null;
  for (const item of b.items) {
    if (item.tileX === tileX && item.tileY === tileY) return item;
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

  // If dragging a selected item to a new position:
  if (
    selectedItem.value &&
    (upPos.x !== mouseDownPos.x || upPos.y !== mouseDownPos.y) &&
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

  // Otherwise: click to select/deselect.
  const hit = hitTest(upPos.x, upPos.y);
  selectedItem.value = hit;
  mouseDownPos = null;
  redraw();
}

// ─── Delete key ─────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const item = selectedItem.value;
    const b = block.value;
    if (!item || !b) return;
    e.preventDefault();
    history.execute(new DeleteItemCommand(b, item, rom.activeSlot));
    selectedItem.value = null;
    redraw();
  }
}

// ─── Drawing ────────────────────────────────────────────────────────

/**
 * Read a tile ID for an item directly from the ROM, mirroring the C++
 * GetSingDim function. Returns { tileId, atlasIndex } or null if the
 * item isn't handled by ROM-read logic.
 *
 * ROM offsets from `cneseditor_tiles.cpp`:
 *   Items 0-5 (blocks):     ROM[0xCB50+id] (or 0xCB57+id for castle world)
 *   Item 16 (big cloud):    ROM[0xCCC2]
 *   Item 17 (small cloud):  ROM[0xCCCE]
 *   Items 32-47 (herbs etc): ROM[0xCD40+(id&0x0F)]
 */
function readItemTileFromRom(itemId: number): number | null {
  const romData = rom.romData;
  if (!romData) return null;
  const r = romData.rom;

  if (itemId >= 0 && itemId <= 5) {
    return r[0xcb50 + itemId] ?? null;
  }
  if (itemId === 16) return r[0xccc2] ?? null;
  if (itemId === 17) return r[0xccce] ?? null;
  if (itemId >= 32 && itemId <= 47) {
    return r[0xcd40 + (itemId & 0x0f)] ?? null;
  }
  return null; // not a ROM-read item, fall back to static table
}

/**
 * Get the tile ID + atlas for an item. Tries ROM-read first (accurate),
 * falls back to static ITEM_DIM (approximate).
 */
function getItemRender(
  rawId: number,
  fx: number,
  objectType: number,
): { tileId: number; atlasIndex: number } | null {
  if (rawId < 0) return null;

  // Try ROM-read first (most accurate).
  const romTile = readItemTileFromRom(rawId < 48 ? rawId : -1);
  if (romTile !== null && romTile !== 0xff) {
    return { tileId: romTile, atlasIndex: ITEM_ATLAS_INDEX };
  }

  // Fall back to static lookup table.
  let tiles: readonly number[];
  if (rawId < 48) {
    const dim = ITEM_DIM[rawId];
    if (!dim) return null;
    tiles = dim;
  } else {
    const baseType = (rawId - 48) >> 4;
    tiles = getItemDimTiles(baseType + 48, fx, objectType);
  }

  const tileId = tiles[0];
  if (tileId === undefined || tileId === 0xff) return null;
  return { tileId, atlasIndex: ITEM_ATLAS_INDEX };
}

/**
 * Draw the ground/background tile pattern. Uses the header's groundSet
 * bitmask to determine which rows have ground tiles, and groundType to
 * pick the tile appearance.
 */
function drawGround(
  ctx: CanvasRenderingContext2D,
  b: LevelBlock,
  widthTiles: number,
  heightTiles: number,
): void {
  const fx = getFxForSlot(rom.activeSlot);
  const atlas = getAtlasImage(fx); // Ground uses atlas 0-3 based on fx/world
  if (!atlas) return;

  const isH = b.header.direction === 1;
  const gsTable = isH ? GROUND_SET_H : GROUND_SET_V;
  const gtTable = isH ? GROUND_TYPE_H : GROUND_TYPE_V;

  const gsValue = gsTable[b.header.groundSet];
  if (gsValue === undefined) return;

  // Ground type: GROUND_TYPE_H[fx][groundType] → [gr0, gr1, gr2, gr3]
  const gtFx = gtTable[fx];
  const gtEntry = gtFx?.[b.header.groundType];
  const groundTileId = gtEntry?.[0]; // gr0 = primary fill tile
  if (groundTileId === undefined || groundTileId === 0xff) return;

  const pages = b.header.length + 1;

  for (let page = 0; page < pages; page++) {
    for (let row = 0; row < 15; row++) {
      // Bitmask interpretation: bit (15 - row) for horizontal levels.
      // Bit 1 = row 14 (bottom), bit 15 = row 0 (top).
      const bitIndex = 15 - row;
      if (!((gsValue >> bitIndex) & 1)) continue;

      for (let col = 0; col < 16; col++) {
        const tx = isH ? page * 16 + col : col;
        const ty = isH ? row : page * 15 + row;
        if (tx >= widthTiles || ty >= heightTiles) continue;

        const { sx, sy } = metatileRect(groundTileId);
        ctx.globalAlpha = 0.35;
        ctx.drawImage(atlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
          tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX);
        ctx.globalAlpha = 1;
      }
    }
  }
}

function drawItemOnCanvas(
  ctx: CanvasRenderingContext2D,
  item: LevelItem,
  objectType: number,
  fx: number,
  isSelected: boolean,
): void {
  if (item.tileX < 0 || item.tileY < 0) return;
  const x = item.tileX * TILE_PX;
  const y = item.tileY * TILE_PX;

  const render = getItemRender(item.itemId, fx, objectType);
  const atlas = render ? getAtlasImage(render.atlasIndex) : null;

  if (atlas && render) {
    const { sx, sy } = metatileRect(render.tileId);
    ctx.drawImage(atlas, sx, sy, METATILE_SIZE, METATILE_SIZE,
      x, y, TILE_PX, TILE_PX);

    // For multi-tile items (jars, vines, doors), also draw middle and
    // bottom tiles if they exist in the static dimension table.
    if (item.itemId < 48) {
      const dimEntry = ITEM_DIM[item.itemId];
      if (dimEntry) {
        const drawExtra = (tid: number | undefined, dy: number) => {
          if (tid === undefined || tid === 0xff) return;
          const r = metatileRect(tid);
          ctx.drawImage(atlas, r.sx, r.sy, METATILE_SIZE, METATILE_SIZE,
            x, y + dy * TILE_PX, TILE_PX, TILE_PX);
        };
        drawExtra(dimEntry[5], 1); // middle
        drawExtra(dimEntry[6], 2); // bottomleft
      }
    }
  } else {
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

  // Selection ring.
  if (isSelected) {
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, TILE_PX, TILE_PX);
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

  // Background.
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, cssW, cssH);

  // Grid.
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

  // Page separators.
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
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

  // Ground rendering (background pattern from groundSet).
  drawGround(ctx, b, widthTiles, heightTiles);

  // Items.
  const fx = getFxForSlot(rom.activeSlot);
  for (const item of b.items) {
    drawItemOnCanvas(ctx, item, b.header.objectType, fx, item === selectedItem.value);
  }

  // Enemy overlay.
  if (editor.showEnemies) {
    const enemyBlock = getEnemyBlock();
    const enemyAtlas = getAtlasImage(ENEMY_ATLAS_INDEX_C);
    if (enemyBlock && enemyAtlas) {
      for (let pageIdx = 0; pageIdx < enemyBlock.pages.length; pageIdx++) {
        const page = enemyBlock.pages[pageIdx]!;
        for (const enemy of page.enemies) {
          const ex = (pageIdx * 16 + enemy.x) * TILE_PX;
          const ey = enemy.y * TILE_PX;
          const dim = ENEMY_DIM[enemy.id];
          const spriteId = dim?.[0];
          if (spriteId !== undefined && spriteId !== 0xff) {
            const { sx, sy } = metatileRect(spriteId);
            ctx.drawImage(enemyAtlas, sx, sy, METATILE_SIZE, METATILE_SIZE, ex, ey, TILE_PX, TILE_PX);
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
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, 220, 28);
  ctx.fillStyle = '#ccc';
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
