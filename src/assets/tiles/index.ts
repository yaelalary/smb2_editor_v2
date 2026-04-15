/**
 * Tile atlas manifest.
 *
 * Generated tiles live in this directory as `tile-NNNN.png`. The atlas
 * is produced by `scripts/extract-chr.ts` (see `npm run extract-chr`)
 * from the user-supplied canonical SMB2 USA PRG0 ROM.
 *
 * Each PNG is an 8x8 grayscale image where the color index (0..3) is
 * encoded in the red channel as 0, 85, 170, 255. Runtime rendering
 * (Unit 6) re-colors these pixels based on the active NES palette.
 *
 * Tile IDs are 0-based and correspond to the tile's position in the
 * concatenated CHR-ROM region of the cartridge.
 */

// `import.meta.glob` is the Vite-idiomatic way to load many static
// assets without listing each import explicitly.
const TILE_MODULES = import.meta.glob<{ default: string }>(
  './tile-*.png',
  { eager: true },
);

/** All tile URLs, ordered by tile ID (0, 1, 2, …). */
export const TILE_URLS: ReadonlyArray<string> = Object.entries(TILE_MODULES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, mod]) => mod.default);

/** Branded numeric identifier for a CHR tile. */
export type TileId = number & { readonly __brand: 'TileId' };

export function tileId(value: number): TileId {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid tile id: ${value}`);
  }
  return value as TileId;
}

/** Resolve a tile URL, throwing loudly if the manifest is incomplete. */
export function getTileUrl(id: TileId): string {
  const url = TILE_URLS[id];
  if (url === undefined) {
    throw new Error(
      `No tile PNG for id ${id}. Did you run \`npm run extract-chr\` ` +
        `against test/fixtures/smb2.nes?`,
    );
  }
  return url;
}

/** Total number of tiles currently available in the bundle. */
export function tileCount(): number {
  return TILE_URLS.length;
}
