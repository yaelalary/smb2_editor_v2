import fs from 'node:fs';
import { PNG } from 'pngjs';

const BG_IDX = process.argv[2] || '1';
const TILE_ID = parseInt(process.argv[3] || '0xa0', 16);

const buf = fs.readFileSync(`src/assets/metatiles/bg-${BG_IDX}.png`);
const png = PNG.sync.read(buf);

const TILE = 16;
const sx = TILE_ID * TILE;

const pixels = new Map();
for (let y = 0; y < TILE; y++) {
  for (let x = 0; x < TILE; x++) {
    const idx = ((y * png.width) + (sx + x)) * 4;
    const r = png.data[idx];
    const g = png.data[idx + 1];
    const b = png.data[idx + 2];
    const a = png.data[idx + 3];
    const key = `${r},${g},${b},${a}`;
    pixels.set(key, (pixels.get(key) || 0) + 1);
  }
}

console.log(`\nBG atlas ${BG_IDX}, tile 0x${TILE_ID.toString(16)} — ${pixels.size} unique colors:`);
for (const [color, count] of [...pixels.entries()].sort((a, b) => b[1] - a[1])) {
  const [r, g, b, a] = color.split(',').map(Number);
  const note = a === 0 ? '(TRANSP)' : r === 255 && g === 0 && b === 255 ? '(MAGENTA=transp key)' : r === g && g === b ? `(gray idx ${Math.floor(r / 16)})` : '';
  console.log(`  rgba(${r},${g},${b},${a}) × ${count} ${note}`);
}
