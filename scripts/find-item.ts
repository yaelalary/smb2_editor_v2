/**
 * Scan every level slot in the ROM and print where a given item ID appears.
 * One-shot helper — run with `npx tsx scripts/find-item.ts <itemId>`.
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

const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
const map = parseLevelMap(rom);

const matches: Array<{ slot: number; block: number; header: string; positions: string[] }> = [];
for (let slot = 0; slot < map.slotToBlock.length; slot++) {
  const blockIdx = map.slotToBlock[slot]!;
  const block = map.blocks[blockIdx]!;
  const hits = block.items.filter((it) => it.itemId === target);
  if (hits.length === 0) continue;
  const h = block.header;
  matches.push({
    slot,
    block: blockIdx,
    header: `dir=${h.direction} fx=${getFxForSlot(slot)} objType=0x${(h.objectType ?? 0).toString(16)} pal=${h.palette}`,
    positions: hits.map((it) => `(${it.tileX},${it.tileY})`),
  });
}

console.log(`Item 0x${target.toString(16).toUpperCase()} (${target}) — ${matches.length} slot(s):\n`);
for (const m of matches) {
  console.log(`  ${slotLabel(m.slot).padEnd(8)} slot=${m.slot.toString().padStart(3)} block=${m.block}  ${m.header}`);
  console.log(`    positions: ${m.positions.join(' ')}`);
}
