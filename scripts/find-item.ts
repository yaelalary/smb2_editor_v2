/**
 * Scan every level slot in the ROM and print where a given item ID appears.
 * One-shot helper — run with `npx tsx scripts/find-item.ts <itemId>`.
 *
 * If `itemId` is in the extended range (`0x30..0xFF`), all 16 size variants
 * (low-nibble 0..F) are scanned together so multi-tile items are found
 * regardless of their placed size.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevelMap } from '../src/rom/level-parser.js';
import { slotLabel, getFxForSlot } from '../src/rom/level-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_PATH = path.resolve(__dirname, '../test/fixtures/smb2.nes');

const target = Number.parseInt(process.argv[2] ?? '31', 10);
if (!Number.isFinite(target) || target < 0 || target > 255) {
  console.error(`usage: tsx scripts/find-item.ts <itemId 0..255>`);
  process.exit(1);
}

const isExtended = target >= 0x30;
const baseHi = target & 0xf0;

function matches(itemId: number): boolean {
  if (isExtended) return (itemId & 0xf0) === baseHi;
  return itemId === target;
}

const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
const map = parseLevelMap(rom);

const matchesByBucket: Array<{ slot: number; block: number; header: string; hits: Array<{ itemId: number; tileX: number; tileY: number }> }> = [];
for (let slot = 0; slot < map.slotToBlock.length; slot++) {
  const blockIdx = map.slotToBlock[slot]!;
  const block = map.blocks[blockIdx]!;
  const hits = block.items.filter((it) => matches(it.itemId));
  if (hits.length === 0) continue;
  const h = block.header;
  matchesByBucket.push({
    slot,
    block: blockIdx,
    header: `dir=${h.direction} fx=${getFxForSlot(slot)} objType=0x${(h.objectType ?? 0).toString(16)} pal=${h.palette}`,
    hits: hits.map((it) => ({ itemId: it.itemId, tileX: it.tileX, tileY: it.tileY })),
  });
}

const desc = isExtended
  ? `Extended item 0x${baseHi.toString(16).toUpperCase()}* (any size)`
  : `Item 0x${target.toString(16).toUpperCase()} (${target})`;
console.log(`${desc} — ${matchesByBucket.length} slot(s):\n`);
for (const m of matchesByBucket) {
  console.log(`  ${slotLabel(m.slot).padEnd(8)} slot=${m.slot.toString().padStart(3)} block=${m.block}  ${m.header}`);
  for (const h of m.hits) {
    const sizeNote = isExtended ? `  size=${(h.itemId & 0x0f) + 1}` : '';
    console.log(`    itemId=0x${h.itemId.toString(16).padStart(2, '0')}  pos=(${h.tileX},${h.tileY})${sizeNote}`);
  }
}
