import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevelMap } from '../src/rom/level-parser.js';
import { slotLabel } from '../src/rom/level-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROM_PATH = path.resolve(__dirname, '../test/fixtures/smb2.nes');

const target = Number.parseInt(process.argv[2] ?? '2', 10);
const rom = new Uint8Array(fs.readFileSync(ROM_PATH));
const map = parseLevelMap(rom);
const block = map.blocks[map.slotToBlock[target]!]!;

console.log(`${slotLabel(target)} slot=${target}`);
for (const it of block.items) {
  if (it.kind !== 'regular') continue;
  const inRange = (it.itemId >= 0x50 && it.itemId <= 0x5f) || (it.itemId >= 32 && it.itemId <= 42);
  if (!inRange) continue;
  const bytes = Array.from(it.sourceBytes).map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  itemId=0x${it.itemId.toString(16).padStart(2, '0')}  pos=(${it.tileX},${it.tileY})  bytes=${bytes}`);
}
