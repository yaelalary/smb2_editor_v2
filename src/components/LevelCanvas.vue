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
import { ENEMY_DIM } from '@/rom/nesleveldef';
import { getBgSet, getBgTile, getWorldGfx, getBPriority } from '@/rom/tile-reader';
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
  getColorizedBgAtlas,
  bgTileRect,
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
    // Plain click: single select OR log ground cell if no item hit
    selectedItems.value = hit ? [hit] : [];
    const romData = rom.romData;
    const b = block.value;
    if (romData && b) {
      if (hit) {
        const rawId = hit.itemId;
        const vid = rawId >= 0x30 ? Math.floor((rawId - 0x30) / 0x10) : null;
        const tiles = renderItem(romData.rom, hit, rom.activeSlot, b.header);
        const bpri = getBPriority(rawId);
        // Dump all groundSet items with their raw bytes so we can verify
        // the parser got them all and compute positions correctly.
        const allGroundSets = b.items
          .map((it, idx) => ({ it, idx }))
          .filter(({ it }) => it.kind === 'groundSet')
          .map(({ it, idx }) => ({
            idx,
            bytes: Array.from(it.sourceBytes).map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' '),
          }));
        console.log('[ALL GROUND SETS IN STREAM]', allGroundSets);
        console.log('[ALL ITEM KINDS]', b.items.map((it) => it.kind));
        // Also check the ground cell at the clicked position (hidden by item).
        const segments = computeGroundSegments(b);
        const { widthTiles, heightTiles } = levelDimensions(b);
        const tmpCanvas = document.createElement('canvas');
        const tmpCtx = tmpCanvas.getContext('2d');
        let groundUnderItem: unknown = 'unknown';
        if (tmpCtx && upPos) {
          const grid = drawGround(tmpCtx, b, widthTiles, heightTiles, null, segments);
          const cell = grid[upPos.x]?.[upPos.y];
          const isH = b.header.direction === 1;
          const col = isH ? upPos.x : upPos.y;
          let applied = segments[0]!;
          for (const seg of segments) {
            if (seg.startPos <= col) applied = seg;
            else break;
          }
          // Dump the full column for the clicked x — see what ground looks like top-to-bottom.
          const colCells: string[] = [];
          for (let y = 0; y < Math.min(heightTiles, 15); y++) {
            const c = grid[upPos.x]?.[y];
            colCells.push(c?.solid ? `y${y}:${c.tileId !== null ? '0x' + c.tileId.toString(16) : 'invis'}` : `y${y}:HOLE`);
          }
          // Also dump the raw groundSet bitmask (32 bits = 16 row pairs).
          const dwGs = getBgSet(romData.rom, applied.groundSet & 0x1f, isH);
          const bitmaskRows: string[] = [];
          for (let row = 0; row < 15; row++) {
            const bit = 30 - row * 2;
            const bs = (dwGs >>> bit) & 0x03;
            bitmaskRows.push(`r${row}:${bs}`);
          }
          groundUnderItem = cell
            ? {
                levelIsH: isH,
                slot: rom.activeSlot,
                levelSize: `${widthTiles}x${heightTiles}`,
                solid: cell.solid,
                tileId: cell.tileId !== null ? '0x' + cell.tileId.toString(16) : null,
                groundSet: '0x' + applied.groundSet.toString(16),
                startPos: applied.startPos,
                columnDump: colCells.join(' '),
                bitmaskRaw: '0x' + dwGs.toString(16).padStart(8, '0'),
                bitmaskPerRow: bitmaskRows.join(' '),
              }
            : 'out of bounds';
        }
        console.log('[ITEM CLICKED]', {
          rawId: '0x' + rawId.toString(16),
          vid,
          pos: `(${hit.tileX}, ${hit.tileY})`,
          bPriority: bpri,
          tileCount: tiles.length,
          firstTile: tiles[0] ? { tileId: '0x' + tiles[0].tileId.toString(16), atlas: tiles[0].atlasIndex, isBg: tiles[0].isBgStrip ?? false } : null,
          groundUnderItem,
        });
      } else if (upPos) {
        // No item at click — log ground grid cell if available.
        // Recompute the ground grid using the same segments to inspect.
        const segments = computeGroundSegments(b);
        const { widthTiles, heightTiles } = levelDimensions(b);
        // Use an off-screen context so drawGround doesn't repaint
        const tmpCanvas = document.createElement('canvas');
        const tmpCtx = tmpCanvas.getContext('2d');
        if (tmpCtx) {
          const grid = drawGround(tmpCtx, b, widthTiles, heightTiles, null, segments);
          const cell = grid[upPos.x]?.[upPos.y];
          // Find which ground segment applies at this column
          const isH = b.header.direction === 1;
          const col = isH ? upPos.x : upPos.y;
          let applied = segments[0];
          for (const seg of segments) {
            if (seg.startPos <= col) applied = seg;
            else break;
          }
          console.log('[GROUND CLICKED]', {
            pos: `(${upPos.x}, ${upPos.y})`,
            cell: cell ? { solid: cell.solid, tileId: cell.tileId !== null ? '0x' + cell.tileId.toString(16) : null } : 'out of bounds',
            appliedSegment: applied ? {
              startPos: applied.startPos,
              groundSet: '0x' + applied.groundSet.toString(16),
              groundType: applied.groundType,
            } : null,
            allSegments: segments.map((s) => ({
              startPos: s.startPos,
              groundSet: '0x' + s.groundSet.toString(16),
              groundType: s.groundType,
            })),
          });
        }
      }
    }
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
  if (!palette) return;
  // BG strip tiles (4096×16): horz/vert ground extended items. Mirrors
  // C++ DrawCanvas type!=0 branch → DrawGrGamma (grtpl = bgN.bmp).
  if (tile.isBgStrip) {
    const src = getColorizedBgAtlas(tile.atlasIndex, palette);
    if (!src) return;
    const { sx, sy } = bgTileRect(tile.tileId);
    ctx.drawImage(
      src, sx, sy, METATILE_SIZE, METATILE_SIZE,
      tile.x * TILE_PX, tile.y * TILE_PX, TILE_PX, TILE_PX,
    );
    return;
  }
  // Item atlas (256×256 metatile grid): default path.
  const src = getColorizedAtlas(tile.atlasIndex, palette);
  if (!src) return;
  const { sx, sy } = metatileRect(tile.tileId);
  ctx.drawImage(
    src, sx, sy, METATILE_SIZE, METATILE_SIZE,
    tile.x * TILE_PX, tile.y * TILE_PX, TILE_PX, TILE_PX,
  );
}

// ─── Ground segment computation ─────────────────────────────────────
// Extracted so both drawGround and vine-groundRow can share the logic.

interface GroundSegment {
  startPos: number;
  groundSet: number;
  groundType: number;
}

/**
 * Walk the item stream and collect ground segments.
 * Each segment records where a groundSet item starts and which
 * groundSet/groundType it carries. Mirrors C++ loader lines 73-99.
 */
function computeGroundSegments(b: LevelBlock): GroundSegment[] {
  const isH = b.header.direction === 1;
  const segments: GroundSegment[] = [];
  let currentGroundType = b.header.groundType;
  segments.push({ startPos: 0, groundSet: b.header.groundSet, groundType: currentGroundType });

  let deltaX = 0;
  let deltaY = 0;
  let lastGroundPos = 0;

  for (const item of b.items) {
    switch (item.kind) {
      case 'skipper': {
        const lowNibble = (item.sourceBytes[0] ?? 0) & 0x0f;
        deltaY = 0;
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
        const reserved = byte0 & 0x0f;
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
    }
  }
  return segments;
}

/**
 * C++ g_mPriorityList.bgPriority lookup.
 * Items with bgPriority=1 cannot draw over ground (ground has z-priority).
 * Tiles landing on solid-ground cells are filtered out in drawItemOnCanvas.
 */
// bgPriority=1 items (raw IDs < 0x30) from g_mPriorityList:
const BG_PRIORITY_IDS = new Set([6, 7, 8, 12, 13, 14, 15, 22, 23, 24, 25, 30, 31]);
function needsGroundClamp(rawId: number): boolean {
  if (rawId < 0x30) return BG_PRIORITY_IDS.has(rawId);
  // Extended items: CONVERT_REGULAR(r) = 0x30 + vid
  // Only vid 9 (=57, green platform) has bgPriority=1.
  const vid = Math.floor((rawId - 0x30) / 0x10);
  return vid === 9;
}

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
/**
 * Ground cell — mirrors C++ NES_GITEM in the canvas grid:
 *   - `solid`: matches C++ fVisible. True when the cell contains ground
 *     (even if the tile is 0xFF/invisible). Blocks bgPriority=1 items.
 *   - `tileId`: the metatile to blit, or null when nothing should be
 *     drawn (hole OR solid-but-invisible 0xFF tile).
 */
export interface GroundCell {
  solid: boolean;
  tileId: number | null;
}

const HOLE_CELL: GroundCell = { solid: false, tileId: null };

function drawGround(
  ctx: CanvasRenderingContext2D,
  b: LevelBlock,
  widthTiles: number,
  heightTiles: number,
  palette: LevelPalette | null,
  segments: GroundSegment[],
): GroundCell[][] {
  const romData = rom.romData;
  if (!romData) {
    return Array.from({ length: widthTiles }, () => new Array<GroundCell>(heightTiles).fill(HOLE_CELL));
  }
  const isH = b.header.direction === 1;
  const world = Math.floor(rom.activeSlot / 30);
  // Ground atlas: bgN.bmp per gfx theme (night/day/desert/winter/castle).
  // Mirrors C++ UseGamma(uColor, fx+4, gfx+10) where gfx = GetFX(world).
  const gfx = getWorldGfx(romData.rom, world);

  // Ground grid: every cell starts as a hole (not solid, no tile).
  const grid: GroundCell[][] = Array.from(
    { length: widthTiles },
    () => new Array<GroundCell>(heightTiles).fill(HOLE_CELL),
  );

  // Build a cell from a bitset value using ROM-based tile lookup.
  // Mirrors C++ DrawGroundEx: reads per-world ground tile IDs via
  // GetBgTile. Bitset=0 → hole. Non-zero + valid tile → solid+visible.
  // Non-zero + 0xFF tile → solid+invisible (C++ SetCanvasItem still
  // marks fVisible=TRUE, which blocks bgPriority=1 items).
  const cellFor = (groundType: number, bitset: number): GroundCell => {
    if (bitset === 0) return HOLE_CELL;
    const tileId = getBgTile(romData.rom, bitset, groundType & 0x07, world, isH);
    return { solid: true, tileId: tileId === 0xff ? null : tileId };
  };

  // Process each segment: write bitmask pattern from startPos to end.
  // Later segments override earlier ones, including clearing to hole.
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx]!;
    const gSetIdx = seg.groundSet & 0x1f;
    // C++ DrawGroundEx: `if ( 0x1f == uSet && 0 == item )` → skip ONLY
    // the initial background (segment 0) when 0x1F. Stream groundSet
    // items with 0x1F are legitimate ground patterns, not a sentinel.
    if (gSetIdx === 0x1f && segIdx === 0) continue;

    const dwGroundSet = getBgSet(romData.rom, gSetIdx, isH);
    const gType = seg.groundType & 0x07;

    if (isH) {
      // Horizontal: iterate columns from startPos to end, rows 0-14
      for (let cx = seg.startPos; cx < widthTiles; cx++) {
        let bit = 30;
        for (let cy = 0; cy < heightTiles; cy++) {
          const bitset = (dwGroundSet >>> bit) & 0x03;
          grid[cx]![cy] = cellFor(gType, bitset);
          bit -= 2;
        }
      }
    } else {
      // Vertical: iterate rows from startPos to end, columns 0-15
      for (let cy = seg.startPos; cy < heightTiles; cy++) {
        let bit = 30;
        for (let cx = 0; cx < widthTiles; cx++) {
          const bitset = (dwGroundSet >>> bit) & 0x03;
          grid[cx]![cy] = cellFor(gType, bitset);
          bit -= 2;
        }
      }
    }
  }

  // Draw the grid — blit from the BG strip atlas (bgN.bmp, 4096×16).
  const bgSrc = palette ? getColorizedBgAtlas(gfx, palette) : null;
  if (bgSrc) {
    for (let cx = 0; cx < widthTiles; cx++) {
      for (let cy = 0; cy < heightTiles; cy++) {
        const cell = grid[cx]![cy]!;
        if (cell.tileId !== null) {
          const { sx, sy } = bgTileRect(cell.tileId);
          ctx.drawImage(
            bgSrc, sx, sy, METATILE_SIZE, METATILE_SIZE,
            cx * TILE_PX, cy * TILE_PX, TILE_PX, TILE_PX,
          );
        }
      }
    }
  }
  return grid;
}

/**
 * Draw a level item using the full multi-tile renderer ported from C++.
 * Falls back to a colored rectangle with hex label if no tiles produced.
 *
 * Per-cell z-priority: if the item has bgPriority=1 (ground wins over it),
 * each tile is tested against `groundGrid` — any tile landing on a cell
 * with solid ground (grid[x][y] !== null) is skipped. This mirrors C++
 * SetCanvasItem which rejects bgPriority=1 tiles over existing ground
 * but allows them over holes (fVisible=false cells).
 */
function drawItemOnCanvas(
  ctx: CanvasRenderingContext2D,
  item: LevelItem,
  isSelected: boolean,
  palette: LevelPalette | null,
  groundGrid: GroundCell[][] | null,
): void {
  if (item.tileX < 0 || item.tileY < 0) return;

  const romData = rom.romData;
  const allTiles: RenderedTile[] = romData
    ? renderItem(romData.rom, item, rom.activeSlot, block.value!.header)
    : [];

  // Apply per-cell ground priority filter for bgPriority=1 items.
  // Matches C++ SetCanvasItem: tiles over a solid cell (fVisible=TRUE)
  // are rejected, including cells where the ground tile is 0xFF.
  const clampAgainstGround =
    groundGrid !== null && item.kind === 'regular' && needsGroundClamp(item.itemId);
  const tiles: RenderedTile[] = clampAgainstGround
    ? allTiles.filter((t) => {
        const col = groundGrid[t.x];
        if (!col) return true; // out of grid bounds — keep tile
        const cell = col[t.y];
        return !cell || !cell.solid; // skip tile only if that cell is solid ground
      })
    : allTiles;

  if (tiles.length > 0) {
    // C++ canvas-grid behavior: an item tile REPLACES the ground at its
    // cell (per SetCanvasItem). The BG/item atlas tile may have
    // transparent pixels (magenta key), which in the C++ render show the
    // level's palette bg color. To emulate this, we fill each item cell
    // with bgColor BEFORE blitting the tile, erasing the ground drawn
    // earlier so transparent parts show bg, not the ground underneath.
    const bgCol = palette?.bgColorCss ?? '#000';
    for (const t of tiles) {
      ctx.fillStyle = bgCol;
      ctx.fillRect(t.x * TILE_PX, t.y * TILE_PX, TILE_PX, TILE_PX);
      blitTile(ctx, t, palette);
    }
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

  // Build ground grid + draw it. Grid is then reused for per-cell
  // z-priority filtering on bgPriority=1 items — mirrors C++
  // SetCanvasItem behavior cell-by-cell, not a static row clamp.
  const segments = computeGroundSegments(b);
  const groundGrid = drawGround(ctx, b, widthTiles, heightTiles, palette, segments);

  // Items — full multi-tile rendering ported from C++ Draw*ObjectEx.
  // Sort by bPriority DESCENDING: high values (back) drawn first, low
  // values (front) drawn last. Mirrors C++ SetCanvasItem priority check
  // (existing.bPriority < new.bPriority → reject new). Stable sort via
  // a stable key preserves stream order within equal priorities.
  const sortedItems = b.items
    .map((item, streamIdx) => ({ item, streamIdx, pri: getBPriority(item.itemId) }))
    .sort((a, b) => (b.pri - a.pri) || (a.streamIdx - b.streamIdx));
  for (const { item } of sortedItems) {
    drawItemOnCanvas(ctx, item, selectedItems.value.includes(item), palette, groundGrid);
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
