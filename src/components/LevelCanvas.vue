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
import { readLevelPalette } from '@/rom/palette-reader';
import type { LevelBlock, LevelItem, EnemyBlock, EnemyItem } from '@/rom/model';
import { ENEMY_DIM, GROUND_TYPE_H, GROUND_TYPE_V } from '@/rom/nesleveldef';
import { getBgSet } from '@/rom/tile-reader';
import { DRAG_MIME, ENEMY_DRAG_MIME } from '@/rom/item-categories';
import { PlaceTileCommand, DeleteItemCommand, MoveItemCommand, DeleteItemsCommand, MoveItemsCommand } from '@/commands/tile-commands';
import { PlaceEnemyCommand, DeleteEnemyCommand } from '@/commands/enemy-commands';
import { renderItem } from '@/rom/item-renderer';
import type { RenderedTile } from '@/rom/item-renderer';
import {
  getAtlasImage,
  metatileRect,
  preloadAllAtlases,
  METATILE_SIZE,
  getColorizedAtlas,
} from '@/assets/metatiles';
import type { LevelPalette } from '@/rom/palette-reader';

const TILE_PX = 16;

const rom = useRomStore();
const history = useHistoryStore();
const editor = useEditorStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const selectedItems = ref<LevelItem[]>([]);
const selectedEnemy = ref<{ enemy: EnemyItem; pageIndex: number } | null>(null);

// Ghost position for drop preview.
const ghostTile = ref<{ x: number; y: number } | null>(null);

// Rubber-band selection rectangle (tile coordinates).
const rubberBand = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

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

// ─── Click, drag-to-move, and rubber-band multi-select ─────────────

let mouseDownPos: { x: number; y: number } | null = null;
let isDraggingSelection = false;

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return;
  mouseDownPos = tileFromEvent(e);
  isDraggingSelection = false;
  rubberBand.value = null;
}

function onMouseMove(e: MouseEvent): void {
  if (!mouseDownPos || e.buttons !== 1) return;
  if (editor.activeTool !== 'tiles') return;

  const pos = tileFromEvent(e);
  if (!pos) return;

  // If dragging from a selected item → will be a group move on mouseUp
  if (selectedItems.value.some((it) => it.tileX === mouseDownPos!.x && it.tileY === mouseDownPos!.y)) {
    return;
  }

  // Rubber-band: drag from empty space
  isDraggingSelection = true;
  rubberBand.value = {
    x1: Math.min(mouseDownPos.x, pos.x),
    y1: Math.min(mouseDownPos.y, pos.y),
    x2: Math.max(mouseDownPos.x, pos.x),
    y2: Math.max(mouseDownPos.y, pos.y),
  };
  redraw();
}

function onMouseUp(e: MouseEvent): void {
  if (e.button !== 0) return;
  const upPos = tileFromEvent(e);
  if (!upPos || !mouseDownPos) {
    mouseDownPos = null;
    rubberBand.value = null;
    return;
  }

  const moved = upPos.x !== mouseDownPos.x || upPos.y !== mouseDownPos.y;

  // ─── Enemy mode ────────────────────────────────────────────────
  if (editor.activeTool === 'enemies') {
    const hitE = hitTestEnemy(upPos.x, upPos.y);
    selectedEnemy.value = hitE;
    selectedItems.value = [];
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Tile mode: rubber-band release → select items in rect ─────
  if (isDraggingSelection && rubberBand.value) {
    const rb = rubberBand.value;
    const b = block.value;
    if (b) {
      const hits = b.items.filter(
        (it) => it.tileX >= 0 && it.tileY >= 0 &&
          it.tileX >= rb.x1 && it.tileX <= rb.x2 &&
          it.tileY >= rb.y1 && it.tileY <= rb.y2,
      );
      selectedItems.value = hits;
    }
    selectedEnemy.value = null;
    rubberBand.value = null;
    isDraggingSelection = false;
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Tile mode: group move (drag selected items) ───────────────
  if (
    selectedItems.value.length > 0 &&
    moved &&
    selectedItems.value.some((it) => it.tileX === mouseDownPos!.x && it.tileY === mouseDownPos!.y)
  ) {
    const b = block.value;
    if (b) {
      const dx = upPos.x - mouseDownPos.x;
      const dy = upPos.y - mouseDownPos.y;
      if (selectedItems.value.length === 1) {
        history.execute(
          new MoveItemCommand(b, selectedItems.value[0]!, upPos.x, upPos.y, rom.activeSlot),
        );
      } else {
        history.execute(
          new MoveItemsCommand(b, selectedItems.value, dx, dy, rom.activeSlot),
        );
      }
    }
    mouseDownPos = null;
    redraw();
    return;
  }

  // ─── Tile mode: click to select/toggle ─────────────────────────
  const hit = hitTestTile(upPos.x, upPos.y);
  if (e.shiftKey && hit) {
    // Shift+click: add to selection
    if (!selectedItems.value.includes(hit)) {
      selectedItems.value = [...selectedItems.value, hit];
    }
  } else if (e.ctrlKey || e.metaKey) {
    // Ctrl+click: toggle individual
    if (hit) {
      const idx = selectedItems.value.indexOf(hit);
      if (idx !== -1) {
        selectedItems.value = selectedItems.value.filter((_, i) => i !== idx);
      } else {
        selectedItems.value = [...selectedItems.value, hit];
      }
    }
  } else {
    // Plain click: single select
    selectedItems.value = hit ? [hit] : [];
  }
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

    // Delete selected tile items (single or multi)?
    const items = selectedItems.value;
    const b = block.value;
    if (items.length > 0 && b) {
      if (items.length === 1) {
        history.execute(new DeleteItemCommand(b, items[0]!, rom.activeSlot));
      } else {
        history.execute(new DeleteItemsCommand(b, items, rom.activeSlot));
      }
      selectedItems.value = [];
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
/**
 * Draw ground for the entire level, processing groundSet items from
 * the stream to handle holes, waterfalls, and terrain changes.
 *
 * Mirrors C++ DrawLevelEx / DrawGroundEx exactly:
 *   1. Build a 2D grid (width × height) where each cell is either a
 *      tile ID or null (no ground).
 *   2. Process ground items in order. Each groundSet item writes its
 *      bitmask pattern from its X position to the end of the canvas,
 *      overriding what was there before (including clearing cells
 *      where bitset=0 — this creates holes).
 *   3. Draw the grid once.
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
  const isH = b.header.direction === 1;
  const fx = getFxForSlot(rom.activeSlot);
  const groundAtlas = fx + 4;
  const gtTable = isH ? GROUND_TYPE_H : GROUND_TYPE_V;

  // Ground grid: null = no tile, number = tile ID.
  const grid: (number | null)[][] = Array.from(
    { length: widthTiles },
    () => new Array<number | null>(heightTiles).fill(null),
  );

  // Collect ground segments from the item stream.
  interface GroundSeg { startPos: number; groundSet: number; groundType: number }
  const segments: GroundSeg[] = [];

  let currentGroundType = b.header.groundType;
  // Default from header (item index "0" in C++ terminology)
  segments.push({ startPos: 0, groundSet: b.header.groundSet, groundType: currentGroundType });

  // Walk items tracking cursor to find groundSet item positions.
  // C++ uses iLastGrSetX to ensure monotonically increasing positions.
  let deltaX = 0;
  let deltaY = 0;
  let lastGroundPos = 0;
  for (const item of b.items) {
    switch (item.kind) {
      case 'skipper': {
        const lowNibble = (item.sourceBytes[0] ?? 0) & 0x0f;
        deltaX += (lowNibble - 1) * 0x10;
        break;
      }
      case 'backToStart':
        deltaX = 0;
        deltaY = 0;
        break;
      case 'regular':
      case 'entrance': {
        const byte0 = item.sourceBytes[0] ?? 0;
        const iy = (byte0 >> 4) & 0x0f;
        deltaY += iy;
        if (deltaY >= 0x0f) {
          deltaY = (deltaY + 1) % 16;
          deltaX += 0x10;
        }
        break;
      }
      case 'groundSet': {
        const byte0 = item.sourceBytes[0] ?? 0;
        const byte1 = item.sourceBytes[1] ?? 0;
        const gSet = byte1 & 0x1f;
        const reserved = byte0 & 0x0f; // 0 for 0xF0, 1 for 0xF1

        // C++ position formula from cneseditor_loader.cpp:73-93
        let pos: number;
        if (isH) {
          pos = deltaX + 8 * reserved + Math.floor(byte1 / 0x20);
          if (pos <= lastGroundPos) pos = lastGroundPos + 1;
        } else {
          pos = 0x0f * Math.floor(deltaX / 0x10) + 8 * reserved + Math.floor(byte1 / 0x20);
          if (pos <= lastGroundPos) pos = lastGroundPos + 1;
        }
        lastGroundPos = pos;

        segments.push({ startPos: pos, groundSet: gSet, groundType: currentGroundType });
        break;
      }
      case 'groundType':
        currentGroundType = (item.sourceBytes[1] ?? 0) & 0x07;
        break;
      default:
        break;
    }
  }

  // Process each segment: write bitmask pattern from startPos to end.
  // Later segments override earlier ones, including clearing (null).
  for (const seg of segments) {
    const gSetIdx = seg.groundSet & 0x1f;
    if (gSetIdx === 0x1f) continue; // skip 0x1F background marker

    const dwGroundSet = getBgSet(romData.rom, gSetIdx, isH);
    const gtEntry = gtTable[fx]?.[seg.groundType & 0x07];

    if (isH) {
      // Horizontal: iterate columns from startPos to end, rows 0-14
      for (let cx = seg.startPos; cx < widthTiles; cx++) {
        let bit = 30;
        for (let cy = 0; cy < heightTiles; cy++) {
          const bitset = (dwGroundSet >>> bit) & 0x03;
          if (bitset === 0) {
            grid[cx]![cy] = null; // Clear = hole
          } else {
            const tileId = gtEntry?.[bitset];
            grid[cx]![cy] = (tileId !== undefined && tileId !== 0xff) ? tileId : null;
          }
          bit -= 2;
        }
      }
    } else {
      // Vertical: iterate rows from startPos to end, columns 0-15
      for (let cy = seg.startPos; cy < heightTiles; cy++) {
        let bit = 30;
        for (let cx = 0; cx < widthTiles; cx++) {
          const bitset = (dwGroundSet >>> bit) & 0x03;
          if (bitset === 0) {
            grid[cx]![cy] = null;
          } else {
            const tileId = gtEntry?.[bitset];
            grid[cx]![cy] = (tileId !== undefined && tileId !== 0xff) ? tileId : null;
          }
          bit -= 2;
        }
      }
    }
  }

  // Draw the grid.
  for (let cx = 0; cx < widthTiles; cx++) {
    for (let cy = 0; cy < heightTiles; cy++) {
      const tileId = grid[cx]![cy];
      if (tileId !== null) {
        blitTile(ctx, { tileId, atlasIndex: groundAtlas, x: cx, y: cy }, palette);
      }
    }
  }
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
    drawItemOnCanvas(ctx, item, selectedItems.value.includes(item), palette);
  }

  // Enemy overlay — enemies use the overworld atlases (0-2) which contain
  // pre-colored enemy sprites. In the C++ tool, Draw(eColor, ...) uses
  // bmTpl[eColor] directly WITHOUT palette colorization. The overworld
  // atlases have the actual enemy colors baked in.
  // Atlas 0 = 5.bmp, atlas 1 = 6.bmp, atlas 2 = 7.bmp.
  // We use fx capped to 0-2 since atlas 3 (9.bmp) is not a valid overworld atlas.
  if (editor.showEnemies) {
    const enemyBlock = getEnemyBlock();
    const fx = getFxForSlot(rom.activeSlot);
    const enemyAtlasIdx = Math.min(fx, 2); // overworld atlas 0-2
    const enemyAtlasSrc = getAtlasImage(enemyAtlasIdx);
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

  // Rubber-band selection rectangle.
  const rb = rubberBand.value;
  if (rb) {
    ctx.fillStyle = 'rgba(255, 204, 0, 0.1)';
    ctx.fillRect(rb.x1 * TILE_PX, rb.y1 * TILE_PX,
      (rb.x2 - rb.x1 + 1) * TILE_PX, (rb.y2 - rb.y1 + 1) * TILE_PX);
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.strokeRect(rb.x1 * TILE_PX + 0.5, rb.y1 * TILE_PX + 0.5,
      (rb.x2 - rb.x1 + 1) * TILE_PX - 1, (rb.y2 - rb.y1 + 1) * TILE_PX - 1);
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
  selectedItems.value = [];
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
      @mousemove="onMouseMove"
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
