/**
 * Scan every level slot for placements of a given enemy ID.
 * Run with `npx tsx scripts/find-enemy.ts <enemyId>`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnemyMap } from '../src/rom/enemy-parser.js';
import { slotLabel, getFxForSlot } from '../src/rom/level-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_PATH = path.resolve(__dirname, '../test/fixtures/smb2.nes');

const target = Number.parseInt(process.argv[2] ?? '40', 10);
if (!Number.isFinite(target) || target < 0 || target > 127) {
  console.error('usage: tsx scripts/find-enemy.ts <enemyId 0..127>');
  process.exit(1);
}

const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
const map = parseEnemyMap(rom);

console.log(`Enemy 0x${target.toString(16).toUpperCase()} (${target}):\n`);
let total = 0;
for (let slot = 0; slot < map.slotToBlock.length; slot++) {
  const blockIdx = map.slotToBlock[slot]!;
  const block = map.blocks[blockIdx]!;
  let firstHitInSlot = true;
  for (let p = 0; p < block.pages.length; p++) {
    const page = block.pages[p]!;
    for (const e of page.enemies) {
      if ((e.id & 0x7f) !== target) continue;
      if (firstHitInSlot) {
        console.log(`  ${slotLabel(slot).padEnd(8)} slot=${slot.toString().padStart(3)} fx=${getFxForSlot(slot)}`);
        firstHitInSlot = false;
      }
      const hidden = (e.id & 0x80) !== 0 ? ' (hidden)' : '';
      console.log(`    page=${p}  pos=(${e.x},${e.y})${hidden}`);
      total++;
    }
  }
}
console.log(`\n${total} placement(s) total.`);
