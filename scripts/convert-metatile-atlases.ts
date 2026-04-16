/**
 * Convert the C++ tool's metatile atlas BMP files to PNG.
 *
 * Reads 24-bit uncompressed BMPs from the cloned `loginsinex/smb2` repo
 * (MIT licensed), converts to PNG using pngjs, writes to
 * `src/assets/metatiles/`.
 *
 * BMP 24-bit uncompressed format (BITMAPINFOHEADER):
 *   - 14 bytes file header + 40 bytes DIB header = 54 bytes before pixels
 *   - Pixel rows are stored bottom-up, BGR order, padded to 4-byte boundary
 *
 * Usage: npm run convert-atlases
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'src', 'assets', 'metatiles');

const SMB2_REPO_PATH =
  process.env['SMB2_REPO_PATH'] ??
  path.resolve(PROJECT_ROOT, '..', 'smb2');

const RC_DIR = path.join(SMB2_REPO_PATH, 'smb2res', 'rc');

const ATLAS_FILES: { index: number; bmpName: string; description: string }[] = [
  { index: 0, bmpName: '5.bmp', description: 'overworld tiles A' },
  { index: 1, bmpName: '6.bmp', description: 'overworld tiles B' },
  { index: 2, bmpName: '7.bmp', description: 'overworld tiles C' },
  { index: 3, bmpName: '9.bmp', description: 'overworld tiles D' },
  { index: 4, bmpName: '1.bmp', description: 'interior / special tiles' },
  { index: 5, bmpName: '2.bmp', description: 'desert / ice tiles' },
  { index: 6, bmpName: '3.bmp', description: 'castle tiles' },
  { index: 7, bmpName: '11.bmp', description: 'underground tiles' },
  { index: 8, bmpName: '12.bmp', description: 'enemy sprites' },
];

const BG_FILES: { index: number; bmpName: string; description: string }[] = [
  { index: 0, bmpName: 'bg0.bmp', description: 'background strip world 0' },
  { index: 1, bmpName: 'bg1.bmp', description: 'background strip world 1' },
  { index: 2, bmpName: 'bg2.bmp', description: 'background strip world 2' },
  { index: 3, bmpName: 'bg3.bmp', description: 'background strip world 3' },
  { index: 4, bmpName: 'bg4.bmp', description: 'background strip world 4' },
];

/**
 * Decode a 24-bit uncompressed BMP and return a pngjs PNG object.
 * Handles the bottom-up row order and BGR→RGB conversion.
 */
function bmpToPng(bmpPath: string): PNG {
  const buf = fs.readFileSync(bmpPath);

  // File header
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) {
    throw new Error(`Not a BMP file: ${bmpPath}`);
  }
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);

  if (bpp !== 24) {
    throw new Error(`Only 24-bit BMP supported, got ${bpp}bpp: ${bmpPath}`);
  }
  if (compression !== 0) {
    throw new Error(`Only uncompressed BMP supported: ${bmpPath}`);
  }

  // Height can be negative (top-down) or positive (bottom-up)
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;

  // Row stride: each row is padded to a 4-byte boundary
  const rowStride = Math.ceil((width * 3) / 4) * 4;

  const png = new PNG({ width, height, colorType: 6 });

  for (let y = 0; y < height; y++) {
    // Source row in the BMP data
    const srcRow = bottomUp ? height - 1 - y : y;
    const srcOffset = dataOffset + srcRow * rowStride;

    for (let x = 0; x < width; x++) {
      const bmpIdx = srcOffset + x * 3;
      const pngIdx = (y * width + x) * 4;

      // BMP stores BGR; PNG needs RGBA
      png.data[pngIdx] = buf[bmpIdx + 2]!;     // R
      png.data[pngIdx + 1] = buf[bmpIdx + 1]!; // G
      png.data[pngIdx + 2] = buf[bmpIdx]!;     // B
      png.data[pngIdx + 3] = 0xff;             // A
    }
  }

  return png;
}

function main(): void {
  if (!fs.existsSync(RC_DIR)) {
    console.error(
      `\nCannot find the smb2 C++ repo at: ${SMB2_REPO_PATH}\n` +
        `Clone https://github.com/loginsinex/smb2 next to this project, or set\n` +
        `SMB2_REPO_PATH to point to it.\n`,
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Source: ${RC_DIR}`);
  console.log(`Output: ${path.relative(PROJECT_ROOT, OUT_DIR)}\n`);

  for (const { index, bmpName, description } of ATLAS_FILES) {
    const src = path.join(RC_DIR, bmpName);
    const dst = path.join(OUT_DIR, `atlas-${index}.png`);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP atlas-${index}: ${bmpName} not found`);
      continue;
    }
    const png = bmpToPng(src);
    fs.writeFileSync(dst, PNG.sync.write(png));
    console.log(`  atlas-${index}.png ← ${bmpName} (${description}) ${png.width}×${png.height}`);
  }

  for (const { index, bmpName, description } of BG_FILES) {
    const src = path.join(RC_DIR, bmpName);
    const dst = path.join(OUT_DIR, `bg-${index}.png`);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP bg-${index}: ${bmpName} not found`);
      continue;
    }
    const png = bmpToPng(src);
    fs.writeFileSync(dst, PNG.sync.write(png));
    console.log(`  bg-${index}.png ← ${bmpName} (${description}) ${png.width}×${png.height}`);
  }

  console.log('\nDone. Commit the generated PNGs in src/assets/metatiles/.');
}

main();
