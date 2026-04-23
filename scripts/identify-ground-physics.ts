/**
 * Identify ROM tile IDs for known-physics ground zones.
 *
 * Given a list of (slot, zoneIdx, physics) anchors that the user has
 * confirmed empirically in an emulator, print the concrete `tileId`
 * values that `getBgTile` emits for each active bitset of the zone.
 * These IDs are what the game's 6502 engine actually reads to decide
 * Mario's interaction — so they're what the `GROUND_PHYSICS` registry
 * in `src/rom/ground-physics.ts` must store.
 *
 * Usage:
 *   npx tsx scripts/identify-ground-physics.ts
 *
 * Output is human-readable: for each anchor, prints the zone's metadata
 * and the tile IDs paired with their expected physics, in a format ready
 * to paste into `GROUND_PHYSICS`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevelMap } from '../src/rom/level-parser.js';
import { computeGroundSegments } from '../src/rom/ground-pass.js';
import { getBgSet, getBgTile, getWorldGfx } from '../src/rom/tile-reader.js';
import { slotLabel, slotWorld } from '../src/rom/level-layout.js';
import { getFxForSlot } from '../src/rom/level-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_PATH = path.resolve(__dirname, '../test/fixtures/smb2.nes');

type Physics = 'solid' | 'diggable' | 'quicksand';

interface Anchor {
  /** Slot id (0..209). Compute from X-Y·Z: (X-1)*30 + (Y-1)*10 + (Z-1). */
  slot: number;
  /** 1-based zone index as displayed in the Ground panel (1 = header). */
  zone: number;
  physics: Physics;
  notes: string;
}

const ANCHORS: Anchor[] = [
  // 6-3·2 zone 2 — user-confirmed quicksand (Mario sinks, rises on jump).
  {
    slot: 5 * 30 + (3 - 1) * 10 + (2 - 1),
    zone: 2,
    physics: 'quicksand',
    notes: 'confirmed in 6-3·2 zone 2',
  },
  // 6-3·3 zone 5 — user-confirmed diggable sand (Mario descends on B+Down).
  {
    slot: 5 * 30 + (3 - 1) * 10 + (3 - 1),
    zone: 5,
    physics: 'diggable',
    notes: 'confirmed in 6-3·3 zone 5',
  },
  // 6-1·1 zone 2 — user-confirmed quicksand. Cross-check whether the
  // tile ID matches 6-3·2 (quicksand) or 6-3·3 (diggable).
  {
    slot: 5 * 30 + (1 - 1) * 10 + (1 - 1),
    zone: 2,
    physics: 'quicksand',
    notes: 'cross-check in 6-1·1 zone 2',
  },
  // 6-1·1 zone 1 — user says it's NOT quicksand in the game. What tile
  // does it paint? Expected: a solid sand variant.
  {
    slot: 5 * 30 + (1 - 1) * 10 + (1 - 1),
    zone: 1,
    physics: 'solid',
    notes: 'cross-check in 6-1·1 zone 1 (user says NOT quicksand)',
  },
];

function main(): void {
  const buf = fs.readFileSync(ROM_PATH);
  const rom = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const map = parseLevelMap(rom);

  const emitted: { world: number; tileId: number; physics: Physics; notes: string }[] = [];

  for (const anchor of ANCHORS) {
    const blockIdx = map.slotToBlock[anchor.slot];
    if (blockIdx === undefined) {
      console.warn(`no block for slot ${anchor.slot}`);
      continue;
    }
    const block = map.blocks[blockIdx]!;
    const world = slotWorld(anchor.slot);
    const isH = block.header.direction === 1;
    const label = slotLabel(anchor.slot);

    const segments = computeGroundSegments(block);
    const seg = segments[anchor.zone - 1];
    if (!seg) {
      console.warn(
        `${label}: only ${segments.length} zones; zone ${anchor.zone} out of range`,
      );
      continue;
    }

    console.log(`\n=== ${label} zone ${anchor.zone} (${anchor.physics}) ===`);
    const fx = getFxForSlot(anchor.slot);
    const gfx = getWorldGfx(rom, world);
    console.log(
      `  slot=${anchor.slot} world=${world} fx=${fx} gfx=${gfx} direction=${isH ? 'H' : 'V'}`,
    );
    console.log(
      `  groundSet=${seg.groundSet} (shape) · groundType=${seg.groundType}`,
    );
    const h = block.header;
    console.log(
      `  HEADER: palette=${h.palette} enemyColor=${h.enemyColor} length=${h.length} objectType=${h.objectType} groundSet=${h.groundSet} groundType=${h.groundType} music=${h.music} reserved=0x${h.reservedBits.toString(16)}`,
    );

    const dw = getBgSet(rom, seg.groundSet & 0x1f, isH);
    const usedBitsets = new Set<number>();
    for (let i = 0; i < 15; i++) {
      const bitset = (dw >>> (30 - i * 2)) & 0x03;
      if (bitset !== 0) usedBitsets.add(bitset);
    }
    if (usedBitsets.size === 0) {
      console.log('  (zone paints no tiles — entirely hole)');
      continue;
    }
    console.log(`  painted bitsets: [${[...usedBitsets].sort().join(', ')}]`);

    for (const bs of [...usedBitsets].sort()) {
      const tileId = getBgTile(rom, bs, seg.groundType, world, isH);
      if (tileId === 0xff) continue;
      console.log(
        `    bitset ${bs} → tile 0x${tileId.toString(16).padStart(2, '0')} (${tileId})`,
      );
      emitted.push({
        world,
        tileId,
        physics: anchor.physics,
        notes: `${anchor.notes} (bitset ${bs})`,
      });
    }
  }

  // Emit paste-ready entries for GROUND_PHYSICS.
  console.log('\n\n--- GROUND_PHYSICS entries (paste into src/rom/ground-physics.ts) ---');
  // Dedupe by (world, tileId) — different zones may share a tile ID.
  const seen = new Set<string>();
  for (const e of emitted) {
    const key = `${e.world}:${e.tileId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      `  { world: ${e.world}, tileId: 0x${e.tileId
        .toString(16)
        .padStart(2, '0')}, physics: '${e.physics}', notes: '${e.notes}' },`,
    );
  }
}

main();
