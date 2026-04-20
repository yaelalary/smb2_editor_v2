/**
 * Editor-only visual aid: each "Herb with X" item (ids 32..42, 43, 45)
 * paints a small sprite above the herb so the user can read at a glance
 * what's inside. Pure UI — the ROM already encodes the herb's contents
 * in the item id, so serialization and gameplay are unaffected.
 *
 * Sprites are blitted from the enemy atlas (atlas-0..3, UseEnemyMask'd
 * so the yellow backdrop is transparent) because that's where SMB2
 * stores the pickup graphics — coin, veggie, bomb, potion, etc. are
 * all enemy IDs 50..64 in the engine, not separate item tiles.
 *
 * Items with no clean ROM sprite (rocket = enemy id 56, ENEMY_DIM entry
 * is 0xff/0xff) fall back to a user-supplied PNG shipped at
 * `src/assets/herb-overlays/<name>.png`. Drop a new image at that path
 * with a transparent background and it gets blitted verbatim.
 */

import { getAtlasImage, METATILE_SIZE } from '@/assets/metatiles';
import rocketOverlayUrl from '@/assets/herb-overlays/rocket.png';

const HERB_CONTENT_TILE: Record<number, number> = {
  32: 0x44, // coin
  33: 0x42, // fresh vegetable
  34: 0x41, // small vegetable
  36: 0x43, // turtle shell
  37: 0x4e, // thrown bomb — red ball with fuse spark (not in ENEMY_DIM)
  38: 0x53, // potion
  39: 0x55, // 1-UP mushroom
  40: 0x45, // POW block
  42: 0x08, // Bob-omb (walking enemy)
  // 43/45 "sub-space Mushroom" are already rendered AS a mushroom — no
  // overlay needed (would just be a mushroom on top of a mushroom).
};

/**
 * Per-item atlas override. Item 37 (bomb) shares tile positions across
 * all enemy atlases but palettes differ: atlas-1 and atlas-3 give red
 * body + black outline, atlas-0 uses green, atlas-2 uses blue outline.
 * Pinning to atlas-1 gives consistent colors regardless of the level's
 * enemy color, and keeps bomb visually distinct from Bob-omb (item 42)
 * which continues to follow the level's enemy atlas.
 */
const HERB_CONTENT_FIXED_ATLAS: Record<number, number> = {
  37: 1,
};

/**
 * Items that use a supplied PNG asset instead of a ROM tile. Image
 * blitted verbatim at the overlay position, scaled to fit the target
 * size with nearest-neighbor (pixel-art friendly).
 */
const HERB_ASSET_URL: Record<number, string> = {
  35: rocketOverlayUrl, // rocket — user-supplied PNG
};

// Lazy-loaded asset cache. Images resolve asynchronously; while an
// image is still loading the overlay paints nothing for that herb,
// which is fine — once the image finishes loading, the next redraw
// (item drag, tool switch, history change) will pick it up.
const assetCache = new Map<string, HTMLImageElement>();

function getAssetImage(url: string): HTMLImageElement | null {
  const cached = assetCache.get(url);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const img = new Image();
  img.src = url;
  assetCache.set(url, img);
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/**
 * Pre-load all herb overlay asset images. Call once at app start so
 * the first render has them available. Returns when every image has
 * resolved (or errored — we tolerate missing files silently).
 */
export async function preloadHerbOverlays(): Promise<void> {
  const urls = Object.values(HERB_ASSET_URL);
  await Promise.all(urls.map((url) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { assetCache.set(url, img); resolve(); };
    img.onerror = () => resolve();
    img.src = url;
  })));
}

export function hasHerbOverlay(itemId: number): boolean {
  return itemId in HERB_CONTENT_TILE || itemId in HERB_ASSET_URL;
}

/**
 * Resolve the enemy atlas image for the current level's enemyColor. The
 * atlas is raw (no palette remap — enemies don't go through UseGamma in
 * C++ either, they blit from pre-masked bmTpl[eColor]).
 * Returns null if the atlas hasn't finished preloading yet.
 */
export function enemyAtlasForLevel(enemyColor: number): HTMLImageElement | null {
  const atlasIdx = 3 - (enemyColor & 0x03);
  return getAtlasImage(atlasIdx);
}

/**
 * Paint the content sprite above the herb tile. The sprite is scaled
 * down (75% of the tile) and hangs half its size above the tile top so
 * it reads as a "thought bubble" showing what the herb contains.
 */
export function drawHerbOverlay(
  ctx: CanvasRenderingContext2D,
  cssX: number,
  cssY: number,
  tileSizePx: number,
  itemId: number,
  enemyAtlas: HTMLImageElement | null,
): void {
  const dSize = tileSizePx * 0.75;
  const dx = cssX + (tileSizePx - dSize) / 2;
  const dy = cssY - dSize * 0.55;

  // Asset path: blit the user-supplied PNG verbatim.
  const assetUrl = HERB_ASSET_URL[itemId];
  if (assetUrl !== undefined) {
    const img = getAssetImage(assetUrl);
    if (!img) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dSize, dSize);
    ctx.restore();
    return;
  }

  // ROM-atlas path: blit one 16×16 tile from the relevant enemy atlas.
  const tileId = HERB_CONTENT_TILE[itemId];
  if (tileId === undefined) return;

  const fixedAtlasIdx = HERB_CONTENT_FIXED_ATLAS[itemId];
  const atlas = fixedAtlasIdx !== undefined ? getAtlasImage(fixedAtlasIdx) : enemyAtlas;
  if (!atlas) return;

  const sx = (tileId & 0x0f) * METATILE_SIZE;
  const sy = ((tileId >> 4) & 0x0f) * METATILE_SIZE;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.drawImage(atlas, sx, sy, METATILE_SIZE, METATILE_SIZE, dx, dy, dSize, dSize);
  ctx.restore();
}
